import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The exporter has no import-time side effects; it configures a scratch vault
// and dynamically imports the config-dependent production modules only when
// exportFixtures() runs. Do NOT statically import config-touching modules
// (filename/moc/save/db) in this file before that call.
import {
	cleanupScratch,
	encodeTagged,
	exportFixtures,
	type ExportManifest
} from '../scripts/export-fixtures';
// Pure production modules (no $env/config dependency) — used to run every
// committed parse fixture through the real parser, independent of the exporter.
import { parse } from '../src/lib/server/vault/frontmatter';
import {
	parseVisitFields,
	parseVisits,
	splitBodyAtVisits,
	summarizeVisits
} from '../src/lib/server/vault/visit';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'fixtures');
const REGEN_HINT =
	'Committed fixtures/ tree is stale or hand-edited — run `pnpm export-fixtures` and commit the diff.';

function walk(dir: string, base = dir): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir).sort()) {
		const abs = path.join(dir, entry);
		if (statSync(abs).isDirectory()) out.push(...walk(abs, base));
		else out.push(path.relative(base, abs).split(path.sep).join('/'));
	}
	return out;
}

function listFixtures(family: string, suffix: string): string[] {
	return readdirSync(path.join(FIXTURES, family))
		.filter((f) => f.endsWith(suffix))
		.sort();
}

const read = (...segments: string[]) => readFileSync(path.join(FIXTURES, ...segments), 'utf8');

describe('golden fixture exporter', () => {
	let firstRun: string;
	let secondRun: string;
	let manifest: ExportManifest;

	beforeAll(async () => {
		firstRun = mkdtempSync(path.join(os.tmpdir(), 'fixtures-drift-a-'));
		secondRun = mkdtempSync(path.join(os.tmpdir(), 'fixtures-drift-b-'));
		manifest = await exportFixtures(firstRun);
		await exportFixtures(secondRun);
	}, 120_000);

	afterAll(async () => {
		await cleanupScratch();
		rmSync(firstRun, { recursive: true, force: true });
		rmSync(secondRun, { recursive: true, force: true });
	});

	it('exports a non-trivial tree', () => {
		expect(manifest.totalFiles).toBeGreaterThan(100);
		expect(Object.keys(manifest.fileCounts)).toEqual(
			expect.arrayContaining([
				'README.md',
				'documents',
				'filenames',
				'frontmatter',
				'fuzz',
				'merge',
				'moc',
				'numbers',
				'visits',
				'yaml-scalars'
			])
		);
	});

	it('is idempotent — two exports in one process are byte-identical', () => {
		const filesA = walk(firstRun);
		const filesB = walk(secondRun);
		expect(filesB).toEqual(filesA);
		for (const rel of filesA) {
			const a = readFileSync(path.join(firstRun, rel));
			const b = readFileSync(path.join(secondRun, rel));
			expect(b.equals(a), `fixture ${rel} differs between two exporter runs`).toBe(true);
		}
	});

	it(`drift guard — committed fixtures/ matches a fresh export (${REGEN_HINT})`, () => {
		const committed = walk(FIXTURES);
		const generated = walk(firstRun);

		const missing = generated.filter((f) => !committed.includes(f));
		const stale = committed.filter((f) => !generated.includes(f));
		expect(missing, `files missing from committed fixtures/: ${missing.join(', ')}\n${REGEN_HINT}`).toEqual([]);
		expect(stale, `stale committed fixture files: ${stale.join(', ')}\n${REGEN_HINT}`).toEqual([]);

		for (const rel of generated) {
			const expected = readFileSync(path.join(firstRun, rel));
			const actual = readFileSync(path.join(FIXTURES, rel));
			expect(actual.equals(expected), `fixtures/${rel} is out of date.\n${REGEN_HINT}`).toBe(true);
		}
	});
});

describe('committed parse fixtures replay through the production parsers', () => {
	it('frontmatter/parse/*.md matches *.expected.json', () => {
		const sources = listFixtures('frontmatter/parse', '.md');
		expect(sources.length).toBeGreaterThan(0);
		for (const file of sources) {
			const content = read('frontmatter/parse', file);
			const expected = JSON.parse(read('frontmatter/parse', file.replace(/\.md$/, '.expected.json')));
			const { frontmatter, body } = parse(content);
			expect({ frontmatter: encodeTagged(frontmatter), body }, `frontmatter/parse/${file}`).toEqual({
				frontmatter: expected.frontmatter,
				body: expected.body
			});
		}
	});

	it('visits/parse/*.md matches *.expected.json', () => {
		const sources = listFixtures('visits/parse', '.md');
		expect(sources.length).toBeGreaterThan(0);
		for (const file of sources) {
			const body = read('visits/parse', file);
			const expected = JSON.parse(read('visits/parse', file.replace(/\.md$/, '.expected.json')));
			const visits = parseVisits(splitBodyAtVisits(body).visitsSection);
			const actual = {
				visits: visits.map((v) => ({ ...v, fields: parseVisitFields(v) })),
				summary: summarizeVisits(visits)
			};
			expect(JSON.parse(JSON.stringify(actual)), `visits/parse/${file}`).toEqual({
				visits: expected.visits,
				summary: expected.summary
			});
		}
	});

	it('documents/*.md match their expected parse JSON and reemit bytes', () => {
		const sources = listFixtures('documents', '.md').filter(
			(f) => !f.endsWith('.expected.md') && !f.endsWith('.reemit.md')
		);
		expect(sources.length).toBeGreaterThan(0);
		for (const file of sources) {
			const content = read('documents', file);
			const expected = JSON.parse(read('documents', file.replace(/\.md$/, '.expected.json')));
			const { frontmatter, body } = parse(content);
			expect(encodeTagged(frontmatter), `documents/${file} frontmatter`).toEqual(expected.frontmatter);
			expect(body, `documents/${file} body`).toBe(expected.body);

			const visits = parseVisits(splitBodyAtVisits(body).visitsSection);
			const actualVisits = visits.map((v) => ({ ...v, fields: parseVisitFields(v) }));
			expect(JSON.parse(JSON.stringify(actualVisits)), `documents/${file} visits`).toEqual(
				expected.visits
			);
			expect(
				JSON.parse(JSON.stringify(summarizeVisits(visits))),
				`documents/${file} summary`
			).toEqual(expected.summary);
		}
	});

	it('documents/01-web-written-full is a serializer fixed point (reemit == source)', () => {
		const source = read('documents', '01-web-written-full.md');
		const reemit = read('documents', '01-web-written-full.reemit.md');
		expect(reemit).toBe(source);
	});
});

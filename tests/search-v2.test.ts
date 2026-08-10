/**
 * Full-body search + "why it matched" snippets — the web half of the fix the
 * iOS app shipped first (its `SearchHitTests` / `SearchableTextTests`).
 *
 * The bug: the FTS `body` column held only `rf.body.slice(0, 1000)`, and
 * Visits sit below Overview in every file, so dish notes were unsearchable.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	HIGHLIGHT_BEGIN,
	HIGHLIGHT_END,
	collapseRun,
	searchRuns,
	searchableText
} from '../src/lib/searchText';

type Modules = {
	queries: typeof import('../src/lib/server/db/queries');
	reconciler: typeof import('../src/lib/server/vault/reconciler');
	schema: typeof import('../src/lib/server/db/schema');
};

let vault: string;
let m: Modules;

function restaurant(name: string, extra: { frontmatter?: string; body?: string } = {}): void {
	const file = [
		'---',
		`id: ${name.toLowerCase().replace(/\s+/g, '-')}-0000-0000-0000-00000000000${name.length % 10}`,
		'schema_version: 1',
		`name: ${name}`,
		extra.frontmatter ?? '',
		'---',
		'',
		extra.body ?? '## Overview\n\nNothing yet.\n'
	]
		.filter((l) => l !== '')
		.join('\n');
	writeFileSync(path.join(vault, 'Restaurants', `${name}.md`), file);
}

beforeAll(async () => {
	vault = mkdtempSync(path.join(os.tmpdir(), 'restauranteer-search-'));
	process.env.VAULT_PATH = vault;
	process.env.VAULT_SUBDIR = 'Restaurants';
	process.env.LOG_LEVEL = 'error';
	mkdirSync(path.join(vault, 'Restaurants', '_Lists'), { recursive: true });

	const [queries, reconciler, schema] = await Promise.all([
		import('../src/lib/server/db/queries'),
		import('../src/lib/server/vault/reconciler'),
		import('../src/lib/server/db/schema')
	]);
	m = { queries, reconciler, schema };
});

afterAll(() => {
	m?.schema.closeDb();
	rmSync(vault, { recursive: true, force: true });
});

beforeEach(() => {
	rmSync(path.join(vault, 'Restaurants'), { recursive: true, force: true });
	mkdirSync(path.join(vault, 'Restaurants', '_Lists'), { recursive: true });
});

describe('searchableText', () => {
	it('strips visit markup but keeps the sentences', () => {
		const plain = searchableText(
			[
				'## Overview',
				'',
				'Hole-in-the-wall.',
				'',
				'## Visits',
				'',
				'### 2026-08-01 — Dinner',
				'',
				'**Food:** The mackerel dumplings are the whole point  ',
				'',
				'- **Cacio e pepe** ★★★★★ — the pasta was perfect',
				'  ![](_attachments/shandong-mama/20260801-190000-1.jpg)'
			].join('\n')
		);
		expect(plain).toContain('Food: The mackerel dumplings are the whole point');
		expect(plain).toContain('Cacio e pepe ★★★★★ — the pasta was perfect');
		expect(plain).toContain('Visits');
		expect(plain).not.toContain('**');
		expect(plain).not.toContain('_attachments');
		expect(plain).not.toContain('jpg');
	});

	it('keeps inline link text, drops the URL', () => {
		expect(searchableText('See [the review](https://example.com/r/9) for more.')).toBe(
			'See the review for more.'
		);
	});
});

describe('highlight runs', () => {
	it('splits marked text and survives adjacent/unterminated markers', () => {
		const b = HIGHLIGHT_BEGIN;
		const e = HIGHLIGHT_END;
		expect(searchRuns(`a ${b}x${e}${b}y${e} z`).map((r) => r.text)).toEqual(['a ', 'x', 'y', ' z']);
		expect(searchRuns(`${b}solo`).map((r) => r.highlighted)).toEqual([true]);
		expect(searchRuns('plain').map((r) => r.highlighted)).toEqual([false]);
	});

	it('collapses inner whitespace but keeps boundary spaces', () => {
		expect(collapseRun('the  pasta\nwas ')).toBe('the pasta was ');
		expect(collapseRun(' lead')).toBe(' lead');
	});
});

describe('full-body FTS', () => {
	it('finds a dish note far below the old 1000-character cap', async () => {
		const padding = 'Overview padding sentence. '.repeat(60); // ~1600 chars
		restaurant('Deep Body', {
			body: [
				'## Overview',
				'',
				padding,
				'',
				'## Visits',
				'',
				'### 2026-08-01 — Dinner',
				'',
				'- **Cacio e pepe** ★★★★★ — the pasta was perfect'
			].join('\n')
		});
		await m.reconciler.fullReconcile();

		expect(m.queries.searchVaultFts('pasta').map((r) => r.name)).toEqual(['Deep Body']);
	});

	it('explains a cuisine match instead of returning a bare row', async () => {
		restaurant('Cuisine Only', { frontmatter: 'cuisine:\n  - Sardinian' });
		await m.reconciler.fullReconcile();

		const [hit] = m.queries.searchVaultFtsHits('sardinian');
		expect(hit.restaurant.name).toBe('Cuisine Only');
		expect(hit.field).toBe('tags');
		expect(searchRuns(hit.snippet!)).toContainEqual({ text: 'Sardinian', highlighted: true });
	});

	it('searches list names', async () => {
		restaurant('Listed', { frontmatter: 'lists:\n  - Date Night' });
		await m.reconciler.fullReconcile();

		const [hit] = m.queries.searchVaultFtsHits('date night');
		expect(hit?.restaurant.name).toBe('Listed');
		expect(hit.field).toBe('tags');
	});

	it('gives a name match no snippet — the title is the answer', async () => {
		restaurant('Unique Name');
		await m.reconciler.fullReconcile();

		const [hit] = m.queries.searchVaultFtsHits('unique');
		expect(hit.field).toBe('name');
		expect(hit.snippet).toBeNull();
	});

	it('does not match tokens from photo paths', async () => {
		restaurant('Photo Heavy', {
			body: '## Visits\n\n### 2026-08-01 — Lunch\n\n![](_attachments/photo-heavy/20260801-120000-1.jpg)\n'
		});
		await m.reconciler.fullReconcile();

		expect(m.queries.searchVaultFts('thumb')).toHaveLength(0);
		expect(m.queries.searchVaultFts('attachments')).toHaveLength(0);
	});

	it('finds a non-ASCII name by its own name', async () => {
		// The old ASCII-only sanitizer dropped these scalars entirely, so a
		// CJK/Cyrillic restaurant could not be found by typing its name.
		restaurant('寿司屋');
		await m.reconciler.fullReconcile();

		expect(m.queries.searchVaultFts('寿司').map((r) => r.name)).toEqual(['寿司屋']);
	});
});

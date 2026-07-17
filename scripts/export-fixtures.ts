/**
 * Cross-language golden-fixture exporter.
 *
 * Imports the PRODUCTION vault modules (frontmatter/visit/merge/filename/moc +
 * the attribute-override serializer in $lib/attributes) unmodified and emits a
 * repo-root `fixtures/` tree that pins the exact web-app file format:
 * (input JSON → expected .md bytes) and (.md → expected parsed JSON). The tree
 * is consumed by both the Vitest suite (tests/fixtures-export.test.ts) and the
 * Swift `VaultFormat` golden tests, so a format change on either side becomes
 * a visible fixture diff instead of a silent sync ping-pong.
 *
 * Regenerate with: pnpm export-fixtures
 * (runs `node --import ./scripts/fixtures-loader.mjs scripts/export-fixtures.ts`
 * — plain Node with type stripping; the loader only maps `$lib/*`,
 * `$env/*` → tests/stubs/env.ts, and extensionless relative imports to `.ts`.)
 *
 * Determinism rules (the drift-guard test regenerates and asserts byte
 * identity, so everything here must be reproducible):
 *   - fixed PRNG seeds, no Math.random / Date.now / new Date() in any content
 *   - no absolute paths in fixture bytes (guarded in write())
 *   - JSON is emitted with JSON.stringify (stable insertion-order keys)
 *
 * Modules that transitively import SvelteKit `$env` (config.ts) are imported
 * dynamically AFTER pointing VAULT_PATH at a throwaway scratch vault, so the
 * production code runs unmodified. filename/moc fixtures exercise the real
 * fs/SQLite paths inside that scratch vault; only vault-relative names land in
 * the fixtures.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* -------------------------------------------------------------------------- */
/* Tagged-scalar JSON encoding                                                */
/* -------------------------------------------------------------------------- */

/**
 * JSON cannot represent everything a YAML value tree can (int vs float with
 * the same numeric value, -0, NaN/Infinity, key order). Everywhere fixture
 * JSON carries YAML values we use this tagged encoding instead:
 *
 *   {"t":"null"}
 *   {"t":"bool","v":true}
 *   {"t":"int","v":"4"}                      // safe integer, decimal string
 *   {"t":"float","v":"4.5","bitsHex":"4012000000000000"}
 *                                            // v = ECMA-262 String(n);
 *                                            // bitsHex = IEEE-754 bits (BE hex)
 *   {"t":"str","v":"text"}
 *   {"t":"arr","v":[Tagged, ...]}
 *   {"t":"map","v":[["key", Tagged], ...]}   // ordered pairs
 *
 * A JS number is "int" iff Number.isSafeInteger(n) and it is not -0; every
 * other number is "float" and carries its exact bits.
 */
export type TaggedValue =
	| { t: 'null' }
	| { t: 'bool'; v: boolean }
	| { t: 'int'; v: string }
	| { t: 'float'; v: string; bitsHex: string }
	| { t: 'str'; v: string }
	| { t: 'arr'; v: TaggedValue[] }
	| { t: 'map'; v: [string, TaggedValue][] };

export function doubleBitsHex(n: number): string {
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, n, false);
	let out = '';
	for (let i = 0; i < 8; i++) out += view.getUint8(i).toString(16).padStart(2, '0');
	return out;
}

export function doubleFromBitsHex(hex: string): number {
	const view = new DataView(new ArrayBuffer(8));
	for (let i = 0; i < 8; i++) view.setUint8(i, parseInt(hex.slice(i * 2, i * 2 + 2), 16));
	return view.getFloat64(0, false);
}

export function encodeTagged(value: unknown): TaggedValue {
	if (value === null) return { t: 'null' };
	if (typeof value === 'boolean') return { t: 'bool', v: value };
	if (typeof value === 'string') return { t: 'str', v: value };
	if (typeof value === 'number') {
		if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
			return { t: 'int', v: String(value) };
		}
		return { t: 'float', v: String(value), bitsHex: doubleBitsHex(value) };
	}
	if (Array.isArray(value)) return { t: 'arr', v: value.map(encodeTagged) };
	if (typeof value === 'object') {
		return {
			t: 'map',
			v: Object.entries(value as Record<string, unknown>).map(
				([k, v]) => [k, encodeTagged(v)] as [string, TaggedValue]
			)
		};
	}
	throw new Error(`encodeTagged: unsupported value of type ${typeof value}`);
}

export function decodeTagged(tagged: TaggedValue): unknown {
	switch (tagged.t) {
		case 'null':
			return null;
		case 'bool':
			return tagged.v;
		case 'str':
			return tagged.v;
		case 'int':
			return Number(tagged.v);
		case 'float':
			return doubleFromBitsHex(tagged.bitsHex);
		case 'arr':
			return tagged.v.map(decodeTagged);
		case 'map': {
			const out: Record<string, unknown> = {};
			for (const [k, v] of tagged.v) out[k] = decodeTagged(v);
			return out;
		}
	}
}

/** Strict deep equality: NaN equals NaN, -0 !== 0, object key ORDER matters. */
export function deepEqualStrict(a: unknown, b: unknown): boolean {
	if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
		return a === b;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((v, i) => deepEqualStrict(v, b[i]));
	}
	const ka = Object.keys(a as object);
	const kb = Object.keys(b as object);
	if (ka.length !== kb.length) return false;
	for (let i = 0; i < ka.length; i++) {
		if (ka[i] !== kb[i]) return false;
		if (!deepEqualStrict((a as never)[ka[i]], (b as never)[ka[i]])) return false;
	}
	return true;
}

/** Encode a YAML value tree, asserting the encoding round-trips exactly. */
function tagged(value: unknown): TaggedValue {
	const encoded = encodeTagged(value);
	if (!deepEqualStrict(decodeTagged(encoded), value)) {
		throw new Error(`tagged-scalar round-trip failed for: ${JSON.stringify(encoded)}`);
	}
	return encoded;
}

/* -------------------------------------------------------------------------- */
/* Seeded PRNG (mulberry32) — the only randomness source in this script        */
/* -------------------------------------------------------------------------- */

export const FUZZ_SEED = 0x5eedf00d;
const FUZZ_CASES = 200;
const RANDOM_DOUBLE_CASES = 64;

type Rng = () => number;

function mulberry32(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const u32 = (rng: Rng) => Math.floor(rng() * 4294967296);
const randInt = (rng: Rng, maxExclusive: number) => Math.floor(rng() * maxExclusive);
const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[randInt(rng, arr.length)];
const chance = (rng: Rng, p: number) => rng() < p;

function randomDouble(rng: Rng): number {
	const view = new DataView(new ArrayBuffer(8));
	view.setUint32(0, u32(rng), false);
	view.setUint32(4, u32(rng), false);
	let n = view.getFloat64(0, false);
	if (!Number.isFinite(n)) {
		// Clear one exponent bit deterministically to force a finite value.
		view.setUint32(0, view.getUint32(0, false) & 0xbfffffff, false);
		n = view.getFloat64(0, false);
	}
	return n;
}

/* -------------------------------------------------------------------------- */
/* Scratch vault (for the fs/SQLite-backed production paths)                   */
/* -------------------------------------------------------------------------- */

type ProductionModules = {
	frontmatter: typeof import('../src/lib/server/vault/frontmatter');
	visit: typeof import('../src/lib/server/vault/visit');
	merge: typeof import('../src/lib/server/vault/merge');
	filename: typeof import('../src/lib/server/vault/filename');
	moc: typeof import('../src/lib/server/vault/moc');
	attributes: typeof import('../src/lib/attributes');
	config: typeof import('../src/lib/server/config');
	queries: typeof import('../src/lib/server/db/queries');
	schema: typeof import('../src/lib/server/db/schema');
};

let scratchRoot: string | null = null;
let modules: ProductionModules | null = null;

/**
 * Point the production config at a throwaway vault, then import the
 * production modules. config.ts reads $env at module-eval time, so the env
 * vars must be set before the first (dynamic) import — this is the documented
 * workaround for the SvelteKit `$env` dependency; production code stays
 * untouched. One scratch vault per process: config freezes its paths on
 * first import.
 */
async function loadProduction(): Promise<{ mods: ProductionModules; scratch: string }> {
	if (modules && scratchRoot) return { mods: modules, scratch: scratchRoot };
	scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'restauranteer-fixtures-'));
	process.env.VAULT_PATH = scratchRoot;
	process.env.VAULT_SUBDIR = 'Restaurants';
	process.env.LOG_LEVEL = 'error';

	const mods: ProductionModules = {
		frontmatter: await import('../src/lib/server/vault/frontmatter'),
		visit: await import('../src/lib/server/vault/visit'),
		merge: await import('../src/lib/server/vault/merge'),
		filename: await import('../src/lib/server/vault/filename'),
		moc: await import('../src/lib/server/vault/moc'),
		attributes: await import('../src/lib/attributes'),
		config: await import('../src/lib/server/config'),
		queries: await import('../src/lib/server/db/queries'),
		schema: await import('../src/lib/server/db/schema')
	};

	if (path.resolve(mods.config.config.vaultPath) !== path.resolve(scratchRoot)) {
		throw new Error(
			'Production config was imported before the scratch vault was configured — ' +
				'do not import config-dependent modules at top level before exportFixtures() runs. ' +
				`(config.vaultPath=${mods.config.config.vaultPath})`
		);
	}
	modules = mods;
	return { mods, scratch: scratchRoot };
}

/** Remove the scratch vault (call once, after the last exportFixtures()). */
export async function cleanupScratch(): Promise<void> {
	if (modules) modules.schema.closeDb();
	if (scratchRoot) await rm(scratchRoot, { recursive: true, force: true });
	modules = null;
	scratchRoot = null;
}

/* -------------------------------------------------------------------------- */
/* Fixture writing                                                            */
/* -------------------------------------------------------------------------- */

class FixtureWriter {
	readonly counts = new Map<string, number>();
	private readonly outRoot: string;
	private readonly forbiddenSubstrings: string[];

	constructor(outRoot: string, forbiddenSubstrings: string[]) {
		this.outRoot = outRoot;
		this.forbiddenSubstrings = forbiddenSubstrings;
	}

	async write(relPath: string, content: string): Promise<void> {
		for (const forbidden of this.forbiddenSubstrings) {
			if (content.includes(forbidden)) {
				throw new Error(`Fixture ${relPath} leaks a machine-specific path (${forbidden})`);
			}
		}
		const abs = path.join(this.outRoot, relPath);
		await mkdir(path.dirname(abs), { recursive: true });
		await writeFile(abs, content, 'utf8');
		const family = relPath.split('/')[0];
		this.counts.set(family, (this.counts.get(family) ?? 0) + 1);
	}

	async json(relPath: string, value: unknown): Promise<void> {
		await this.write(relPath, JSON.stringify(value, null, '\t') + '\n');
	}
}

/** Versions of the emission-defining deps (resolved through gray-matter, since
 * js-yaml is a transitive dep under pnpm's strict layout). */
const emissionDepVersions = async (): Promise<{ grayMatter: string; jsYaml: string }> => {
	const rootRequire = createRequire(pathToFileURL(path.join(ROOT, 'package.json')).href);
	const gmPkgPath = rootRequire.resolve('gray-matter/package.json');
	const yamlPkgPath = createRequire(gmPkgPath).resolve('js-yaml/package.json');
	const version = async (p: string) =>
		(JSON.parse(await readFile(p, 'utf8')) as { version: string }).version;
	return { grayMatter: await version(gmPkgPath), jsYaml: await version(yamlPkgPath) };
};

/* -------------------------------------------------------------------------- */
/* Shared building blocks                                                     */
/* -------------------------------------------------------------------------- */

const LONG_SENTENCE =
	'This is a deliberately long sentence that exceeds the eighty character line width and therefore must fold.';
const LONG_URL =
	'https://example.com/a/very/long/path/that/exceeds/eighty/characters/without/any/spaces-so-it-cannot-break';

const AMBIGUOUS_STRINGS = [
	'yes',
	'no',
	'Yes',
	'No',
	'YES',
	'NO',
	'y',
	'Y',
	'n',
	'N',
	'on',
	'On',
	'ON',
	'off',
	'Off',
	'OFF',
	'true',
	'True',
	'TRUE',
	'false',
	'False',
	'FALSE',
	'null',
	'Null',
	'NULL',
	'~'
] as const;

/* -------------------------------------------------------------------------- */
/* Family: frontmatter/serialize                                              */
/* -------------------------------------------------------------------------- */

async function emitFrontmatterSerialize(w: FixtureWriter, mods: ProductionModules) {
	const { stringify } = mods.frontmatter;

	const BODY = '## Overview\n\nA Flinders Lane classic.\n\n## Visits\n';
	const cases: Array<{ name: string; fm: Record<string, unknown>; body: string }> = [
		{
			name: '01-minimal',
			fm: { id: '0d9f6f5a-3c9b-4a51-8e0f-6a4a3b2c1d0e', schema_version: 1, name: 'Cumulus Inc' },
			body: '## Overview\n\n## Visits\n'
		},
		{
			name: '02-full-schema',
			fm: {
				id: '4b3a2c1d-0e9f-4a51-8e0f-aa4a3b2c1d0e',
				schema_version: 1,
				name: 'Cumulus Inc',
				aliases: ['Cumulus', 'カフェ・キュムラス'],
				address: '45 Flinders Ln, Melbourne VIC 3000, Australia',
				suburb: 'Melbourne',
				lat: -37.8148096,
				lng: 144.9704353,
				phone: '+61 3 9650 1445',
				website: 'https://cumulusinc.com.au/',
				socials: {
					instagram: 'https://www.instagram.com/cumulusinc_/',
					facebook: 'https://www.facebook.com/cumulusinc'
				},
				hours: {
					mon: '7:00 am – 11:00 pm',
					tue: '7:00 am – 11:00 pm',
					wed: '7:00 am – 11:00 pm',
					thu: '7:00 am – 11:00 pm',
					fri: '7:00 am – 12:00 am',
					sat: '8:00 am – 12:00 am',
					sun: 'Closed'
				},
				cuisine: ['Modern Australian', 'Wine Bar'],
				price_level: 3,
				place_ids: { google: 'ChIJwYCC5spC1moRZ3TV4zNAfDo', apple: 'IA1B2C3D4E5F6789' },
				lists: ['Date Night', 'CBD Lunch'],
				list_memberships: [
					{ list: 'Date Night', notes: 'ask for the window bench', icon: '🍷' },
					{ list: 'CBD Lunch' }
				],
				tags: ['wine', 'small-plates', 'brunch'],
				rating: 4.5,
				attributes: { dog_friendly: 'yes', sunday_lunch: 'no', has_fireplace: 'yes' },
				last_synced: '2026-07-01T10:30:00.000Z'
			},
			body: BODY
		},
		{
			name: '03-yaml-11-ambiguous-scalars',
			fm: {
				id: 'f0e1d2c3-b4a5-4968-8776-655443322110',
				name: 'Yes Please',
				suburb: 'ON',
				motto: 'no',
				answer: 'Y',
				maybe: 'n',
				switch: 'off',
				verdict: 'True',
				attributes: { y: 'yes', n: 'no', on: 'yes', off: 'no' }
			},
			body: ''
		},
		{
			name: '04-unknown-keys-passthrough',
			fm: {
				id: '11112222-3333-4444-8555-666677778888',
				schema_version: 1,
				name: 'Etta',
				articles: [
					{
						title:
							'The 38 Essential Restaurants You Absolutely Must Visit In Melbourne Before The End Of This Decade',
						url: 'https://www.broadsheet.com.au/melbourne/food-and-drink/article/38-essential-restaurants-you-must-visit',
						source: 'broadsheet',
						published: '2024-11-02'
					},
					{ title: 'Short one', url: 'https://example.com/a', source: 'manual' }
				],
				custom_note: 'first line\nsecond line\nthird line',
				custom_flag: true,
				custom_null: null,
				custom_int: 42,
				custom_float: 0.5,
				review_score: '4.5'
			},
			body: BODY
		},
		{
			name: '05-empty-containers',
			fm: {
				id: '99998888-7777-4666-8555-444433332222',
				name: 'Empty Nest',
				aliases: [],
				lists: [],
				tags: [],
				socials: {},
				hours: {},
				attributes: {}
			},
			body: '## Overview\n\n## Visits\n'
		},
		{
			name: '06-nulls-and-booleans',
			fm: {
				id: 'aaaa1111-bbbb-4222-8ccc-dddd3333eeee',
				name: 'Null & Void',
				phone: null,
				website: null,
				verified: true,
				closed_permanently: false
			},
			body: ''
		},
		{
			name: '07-number-shapes',
			fm: {
				id: 'cafe0000-1111-4222-8333-deadbeef4444',
				name: 'Number Station',
				lat: -37.81627499999999,
				lng: 144.96315733242035,
				rating: 4,
				price_level: 1,
				popularity: 1e21,
				tiny_number: 1e-7,
				neg_zero: -0,
				big_plain: 1e20,
				sixth: 0.16666666666666666
			},
			body: ''
		},
		{
			name: '08-multiline-strings',
			fm: {
				id: 'feed0000-1111-4222-8333-abcdef987654',
				name: 'Block Party',
				strip_chomp: 'line one\nline two\nline three',
				clip_chomp: 'line one\nline two\n',
				keep_chomp: 'line one\nline two\n\n',
				leading_newline: '\nstarts after a blank',
				inner_blank: 'para one\n\npara two',
				trailing_space_line: 'line one \nline two'
			},
			body: ''
		},
		{
			name: '09-insertion-order-preserved',
			fm: {
				zeta: 'last alphabetically, first in file',
				name: 'Order Matters',
				custom_between: 7,
				id: '0123abcd-4444-4555-8666-777788889999',
				alpha: 'first alphabetically, last in file'
			},
			body: ''
		},
		{
			name: '10-special-characters',
			fm: {
				id: '5f5f5f5f-6a6a-4b7b-8c8c-9d9d9d9d9d9d',
				name: "L'Hôtel: The \"Best\" Bar",
				starts_dash: '- not a list item',
				starts_question: '? not a key',
				starts_colon: ': not a mapping',
				starts_hash: '# not a comment',
				starts_amp: '&not-an-anchor',
				starts_star: '*not-an-alias',
				starts_bracket: '[not, a, list]',
				starts_brace: '{not: a, map: here}',
				starts_pipe: '| not a block',
				starts_gt: '> not folded',
				starts_pct: '%not-a-directive',
				starts_tick: '`not-code',
				starts_at: '@handle',
				starts_dq: '"quoted"',
				starts_sq: "'quoted'",
				inner_colon_space: 'note: remember this',
				inner_hash: 'rating 4 # not a comment',
				ends_colon: 'trailing:',
				equals: '=',
				quote_doubling: "it's got 'quotes' in it"
			},
			body: ''
		},
		{
			name: '11-unicode',
			fm: {
				id: '7e7e7e7e-8f8f-4a9a-8b0b-1c1c1c1c1c1c',
				name: 'Café Höhe',
				stars_plain: 'Stars ★★★☆☆ and more',
				em_dash: 'before — after',
				cjk: '日本語のテキストです',
				emoji_astral: 'ramen 🍜 time',
				mixed: 'café ★ — 🍷 fin',
				nbsp: 'non\u00a0breaking',
				accents: 'crème brûlée à la François'
			},
			body: ''
		},
		{
			name: '12-long-strings-folding',
			fm: {
				id: '2b2b2b2b-3c3c-4d4d-8e5e-6f6f6f6f6f6f',
				name: 'Fold Inn',
				folds: LONG_SENTENCE,
				long_url: LONG_URL,
				len79: 'a'.repeat(39) + ' ' + 'b'.repeat(39),
				len80: 'a'.repeat(40) + ' ' + 'b'.repeat(39),
				len81: 'a'.repeat(40) + ' ' + 'b'.repeat(40),
				long_word_then_tail: 'x'.repeat(100) + ' tail',
				head_then_long_word: 'head ' + 'y'.repeat(100),
				many_words:
					'word '.repeat(40).trim()
			},
			body: ''
		},
		{
			name: '13-deep-nesting',
			fm: {
				id: '3d3d3d3d-4e4e-4f4f-8a6a-7b7b7b7b7b7b',
				name: 'Deep Dish',
				matrix: [
					[1, 2],
					[3]
				],
				list_of_maps: [{ a: [true, false] }, { b: { c: ['x'] } }],
				nested: { level1: { level2: { level3: { deep: 'yes', list: ['no', LONG_SENTENCE] } } } }
			},
			body: ''
		},
		{
			name: '14-empty-frontmatter',
			fm: {},
			body: '# Just A Note\n\nNo frontmatter block should be emitted for an empty map.\n'
		},
		{
			name: '15-empty-body',
			fm: { id: '6c6c6c6c-7d7d-4e8e-8f9f-0a0a0a0a0a0a', schema_version: 1, name: 'No Body' },
			body: ''
		},
		{
			name: '16-ambiguous-keys',
			fm: {
				'123': 'integer-like key floats to the front (JS property order)',
				id: '8e8e8e8e-9f9f-4a0a-8b1b-2c2c2c2c2c2c',
				name: 'Key West',
				y: 'key needs quoting',
				on: 'this one too',
				'open hours': 'plain key with space',
				'a:b': 'colon key',
				'a: b': 'colon-space key',
				'': 'empty key'
			},
			body: ''
		}
	];

	for (const c of cases) {
		const expected = stringify(c.fm as never, c.body);
		await w.json(`frontmatter/serialize/${c.name}.json`, {
			name: c.name,
			frontmatter: tagged(c.fm),
			body: c.body
		});
		await w.write(`frontmatter/serialize/${c.name}.expected.md`, expected);
	}
	return cases.length;
}

/* -------------------------------------------------------------------------- */
/* Family: frontmatter/parse                                                  */
/* -------------------------------------------------------------------------- */

async function emitFrontmatterParse(w: FixtureWriter, mods: ProductionModules) {
	const { parse } = mods.frontmatter;

	const cases: Array<{ name: string; content: string }> = [
		{
			name: '01-basic',
			content:
				'---\nid: 0d9f6f5a-3c9b-4a51-8e0f-6a4a3b2c1d0e\nschema_version: 1\nname: Cumulus Inc\ntags:\n  - wine\n  - brunch\n---\n## Overview\n\n## Visits\n'
		},
		{
			name: '02-unquoted-booleans',
			content:
				'---\na: yes\nb: No\nc: TRUE\nd: false\ne: on\nf: Off\ng: y\nh: N\nquoted: \'yes\'\n---\nbody\n'
		},
		{
			name: '03-timestamps-normalize-to-iso',
			content:
				'---\nzulu: 2026-07-17T09:30:00Z\nmillis: 2026-07-17T09:30:00.123Z\noffset: 2026-07-17T09:30:00+10:00\ndate_only: 2026-07-17\nspaced: 2001-12-14 21:59:43.10 -5\nquoted: \'2026-07-17T09:30:00.000Z\'\n---\n'
		},
		{
			name: '04-number-formats',
			content:
				'---\nint: 4\nfloat: 4.5\nnegative: -37.8136\nexp: 6.85e+5\nplus: +7\noctal: 010\nhex: 0x1F\nbinary: 0b101\nunderscores: 1_000_000\nsexagesimal: 190:20:30\ninf: .inf\nneg_inf: -.inf\nnot_a_number: .nan\n---\n'
		},
		{
			name: '05-null-variants',
			content: '---\ntilde: ~\nword: null\ntitle_case: Null\nupper: NULL\nempty_value:\n---\nbody\n'
		},
		{
			name: '06-quoted-scalars',
			content:
				"---\nsingle: 'it''s doubled'\ndouble: \"line\\nbreak and tab\\t\"\nunicode_escape: \"star \\u2605 astral \\U0001F35C\"\nplain_inner_colon: a:b\nsingle_keeps_backslash: 'no\\escape'\n---\n"
		},
		{
			name: '07-block-scalars',
			content:
				'---\nliteral: |\n  line one\n  line two\nliteral_strip: |-\n  line one\n  line two\nliteral_keep: |+\n  line one\n  line two\n\nfolded: >\n  folded across\n  lines\nfolded_strip: >-\n  folded across\n  lines\n---\nbody\n'
		},
		{
			name: '08-flow-styles',
			content: "---\nflow_map: {a: 1, b: [x, 'yes', 2026-01-05]}\nflow_seq: [1, 2.5, yes, text]\n---\n"
		},
		{
			name: '09-anchors-and-aliases',
			content: '---\nbase: &shared Shared Text\ncopy: *shared\nlist:\n  - *shared\n---\n'
		},
		{
			name: '10-no-frontmatter',
			content: '# Cumulus Inc\n\nJust body text, no frontmatter block at all.\n'
		},
		{ name: '11-empty-frontmatter-block', content: '---\n---\nbody after empty block\n' },
		{ name: '12-comment-only-frontmatter', content: '---\n# only a comment in here\n---\nbody\n' },
		{
			name: '13-crlf-line-endings',
			content: '---\r\nname: Windows File\r\ntags:\r\n  - a\r\n---\r\nbody line\r\nsecond line\r\n'
		},
		{ name: '14-bom-stripped', content: '﻿---\nname: BOM File\n---\nbody\n' },
		{
			name: '15-body-whitespace-preserved',
			content: '---\nname: Spacey\n---\n\n\nbody starts after two blank lines\n\ttab-indented line\ntrailing blank lines follow\n\n\n'
		},
		{
			name: '16-close-delimiter-quirks',
			content: '---\nname: Quirky\n--- \nbody after a close delimiter with a trailing space\n'
		},
		{ name: '17-no-newline-at-eof', content: '---\nname: Abrupt\n---' },
		{
			name: '18-scalar-root-frontmatter',
			content: '---\njust a plain string where a map should be\n---\nbody\n'
		},
		{ name: '19-sequence-root-frontmatter', content: '---\n- a\n- b\n---\nbody\n' },
		{
			name: '20-schema-shaped-realistic',
			content:
				'---\nid: 4b3a2c1d-0e9f-4a51-8e0f-aa4a3b2c1d0e\nschema_version: 1\nname: Marion\naliases:\n  - Marion Wine Bar\naddress: 53 Gertrude St, Fitzroy VIC 3065, Australia\nsuburb: Fitzroy\nlat: -37.8078126\nlng: 144.9830968\nphone: +61 3 9419 6262\nwebsite: https://marionwine.com.au/\nsocials:\n  instagram: https://www.instagram.com/marionwinebar/\nhours:\n  mon: Closed\n  tue: 5:00 – 11:00 pm\ncuisine:\n  - Wine Bar\nprice_level: 2\nplace_ids:\n  google: ChIJd0uW-cRC1moRVJPHRXO7lRs\nlists:\n  - Date Night\nlist_memberships:\n  - list: Date Night\n    notes: window seats\ntags:\n  - wine\nrating: 4.5\nattributes:\n  dog_friendly: \'yes\'\n  sunday_lunch: \'no\'\nunquoted_attr: yes\nlast_synced: \'2026-07-01T10:30:00.000Z\'\narticles:\n  - title: A long piece\n    url: https://example.com/read\n---\n## Overview\n\nGoogle: ★ 4.6 (1,234 reviews)\n\n## Visits\n'
		}
	];

	for (const c of cases) {
		const { frontmatter, body } = parse(c.content);
		await w.write(`frontmatter/parse/${c.name}.md`, c.content);
		await w.json(`frontmatter/parse/${c.name}.expected.json`, {
			name: c.name,
			frontmatter: tagged(frontmatter),
			body
		});
	}
	return cases.length;
}

/* -------------------------------------------------------------------------- */
/* Family: yaml-scalars                                                        */
/* -------------------------------------------------------------------------- */

async function emitYamlScalars(w: FixtureWriter, mods: ProductionModules) {
	const { stringify } = mods.frontmatter;

	const entries: Array<[string, string]> = [
		['empty', ''],
		['single-space', ' '],
		['double-space', '  '],
		['single-char', 'a'],
		...AMBIGUOUS_STRINGS.map((s) => [`ambiguous-${s.toLowerCase()}-${s}`, s] as [string, string]),
		['not-quite-bool', 'y e s'],
		['iso-zulu-millis', '2026-07-17T09:30:00.000Z'],
		['iso-zulu', '2026-07-17T09:30:00Z'],
		['iso-offset', '2026-07-17T09:30:00+10:00'],
		['date-only', '2026-07-17'],
		['datetime-spaced', '2026-07-17 09:30:00'],
		['clock-time', '12:30'],
		['sexagesimal', '190:20:30'],
		['leading-space', ' leading'],
		['trailing-space', 'trailing '],
		['both-spaces', ' both '],
		['inner-runs', 'inner  double  spaces'],
		['apostrophe', "it's"],
		['only-quotes', "''"],
		['many-apostrophes', "won't stop, won't quit, won't fold"],
		['looks-int', '4'],
		['looks-float', '4.5'],
		['looks-neg-zero', '-0'],
		['looks-plus-int', '+7'],
		['looks-exp', '1e3'],
		['looks-hex', '0x1F'],
		['looks-octal', '0o17'],
		['looks-old-octal', '010'],
		['looks-binary', '0b101'],
		['looks-underscore', '1_000'],
		['looks-inf', '.inf'],
		['looks-neg-inf', '-.inf'],
		['looks-nan', '.nan'],
		['version-like', '0.1.2'],
		['dot-trailing', '1.'],
		['long-fold', LONG_SENTENCE],
		['long-url', LONG_URL],
		['len79-with-break', 'a'.repeat(39) + ' ' + 'b'.repeat(39)],
		['len80-with-break', 'a'.repeat(40) + ' ' + 'b'.repeat(39)],
		['len81-with-break', 'a'.repeat(40) + ' ' + 'b'.repeat(40)],
		['long-word-then-tail', 'x'.repeat(100) + ' tail'],
		['head-then-long-word', 'head ' + 'y'.repeat(100)],
		['many-words', 'word '.repeat(40).trim()],
		['stars', '★★★★☆'],
		['stars-mixed', 'Stars ★ and ☆ here'],
		['em-dash', 'before — after'],
		['accented', 'café crème brûlée'],
		['cjk', '日本語テキスト'],
		['emoji-astral', '🍜 ramen'],
		['mixed-unicode', 'mixed 🍜 ★ — café'],
		['multiline-basic', 'a\nb'],
		['multiline-clip', 'a\nb\n'],
		['multiline-keep', 'a\nb\n\n'],
		['multiline-leading-newline', '\na'],
		['multiline-inner-blank', 'a\n\nb'],
		['multiline-trailing-space-line', 'a \nb'],
		['multiline-leading-space-line', 'a\n b'],
		['multiline-long-line', 'first line\n' + LONG_SENTENCE + '\nlast line'],
		['starts-dash', '- item'],
		['starts-question', '? maybe'],
		['starts-colon', ': colon'],
		['starts-hash', '# hash'],
		['starts-at', '@at'],
		['starts-backtick', '`tick'],
		['starts-bang', '!bang'],
		['starts-amp', '&amp'],
		['starts-star', '*star'],
		['starts-pct', '%pct'],
		['starts-bracket', '[a, b]'],
		['starts-brace', '{a: b}'],
		['starts-dq', '"dq"'],
		['starts-sq', "'sq'"],
		['starts-pipe', '| pipe'],
		['starts-gt', '> gt'],
		['starts-eq', '='],
		['inner-colon-space', 'key: value'],
		['inner-hash-space', 'a # b'],
		['ends-colon', 'ends:'],
		['comma-separated', 'a,b'],
		['tab-inside', 'a\tb'],
		['tab-only', '\t'],
		['control-bell', 'a\x07b'],
		['control-nul', 'a\x00b'],
		['control-del', 'a\x7fb'],
		['nel', 'a\u0085b'],
		['line-separator', 'a\u2028b'],
		['nbsp', 'a\u00a0b']
	];

	const cases = entries.map(([name, value]) => ({
		name,
		value: tagged(value),
		flat: stringify({ v: value } as never, ''),
		nested: stringify({ nest: { list: [value] } } as never, '')
	}));

	await w.json('yaml-scalars/scalars.json', {
		description:
			'String quoting/folding torture set. Each case is emitted through the production ' +
			'frontmatter serializer in two contexts: flat = stringify({v: <value>}, "") and ' +
			'nested = stringify({nest: {list: [<value>]}}, ""). Expected fields hold the full ' +
			'emitted document bytes.',
		cases
	});
	return cases.length;
}

/* -------------------------------------------------------------------------- */
/* Family: numbers                                                             */
/* -------------------------------------------------------------------------- */

async function emitNumbers(w: FixtureWriter, mods: ProductionModules) {
	const { stringify } = mods.frontmatter;

	const curated: Array<[string, number]> = [
		['zero', 0],
		['neg-zero', -0],
		['one', 1],
		['neg-one', -1],
		['four', 4],
		['four-point-five', 4.5],
		['neg-two-point-five', -2.5],
		['tenth', 0.1],
		['three-tenths', 0.3],
		['point-one-plus-point-two', 0.1 + 0.2],
		['third', 1 / 3],
		['two-thirds', 2 / 3],
		['visit-avg-4-3', 4.3],
		['half', 0.5],
		['pi-ish', 3.141592653589793],
		['hundred', 100],
		['thousand', 1e3],
		['lat-melbourne', -37.8136],
		['lng-melbourne', 144.9631],
		['decimal-mix', 12345.6789],
		['e15', 1e15],
		['e16', 1e16],
		['e20', 1e20],
		['e21-exponent-threshold', 1e21],
		['e22', 1e22],
		['five-e21', 5e21],
		['e100', 1e100],
		['max-safe-integer', Number.MAX_SAFE_INTEGER],
		['above-max-safe', 9007199254740993],
		['two-pow-53', 2 ** 53],
		['two-pow-63', 2 ** 63],
		['e-5', 1e-5],
		['e-6-decimal-threshold', 0.000001],
		['e-7-exponent', 1e-7],
		['one-point-five-e-7', 1.5e-7],
		['two-point-five-e-8', 2.5e-8],
		['e-21', 1e-21],
		['min-subnormal', 5e-324],
		['subnormal', 1e-310],
		['min-normal', 2.2250738585072014e-308],
		['max-value', Number.MAX_VALUE],
		['neg-max-value', -Number.MAX_VALUE],
		['epsilon', Number.EPSILON],
		['nan', NaN],
		['infinity', Infinity],
		['neg-infinity', -Infinity]
	];

	const rng = mulberry32(FUZZ_SEED ^ 0x0000d0b1);
	const randomCases: Array<[string, number]> = [];
	for (let i = 0; i < RANDOM_DOUBLE_CASES; i++) {
		randomCases.push([`random-${String(i).padStart(2, '0')}`, randomDouble(rng)]);
	}

	const cases = [...curated, ...randomCases].map(([name, n]) => ({
		name,
		bitsHex: doubleBitsHex(n),
		js: String(n),
		flat: stringify({ v: n } as never, ''),
		nested: stringify({ nest: { list: [n] } } as never, '')
	}));

	await w.json('numbers/doubles.json', {
		description:
			'JS number formatting pack. bitsHex = IEEE-754 double bits (big-endian hex) — ' +
			'reconstruct the exact double from it. js = ECMA-262 String(n). flat/nested = full ' +
			'document bytes from the production serializer at two indent levels ' +
			'(stringify({v: n}, "") and stringify({nest: {list: [n]}}, "")). Note the int vs ' +
			'float dump paths: integer-valued doubles emit String(n) verbatim (even 1e+21); ' +
			'non-integers get js-yaml\'s ".e" insertion (1e-7 → 1.e-7); -0 emits -0.0; ' +
			'NaN/±Infinity emit .nan/.inf/-.inf.',
		seed: `0x${(FUZZ_SEED ^ 0x0000d0b1).toString(16)}`,
		cases
	});
	return cases.length;
}

/* -------------------------------------------------------------------------- */
/* Family: visits (serialize / parse / body-ops)                               */
/* -------------------------------------------------------------------------- */

type VisitInputJson = import('../src/lib/server/vault/visit').VisitInput;

async function emitVisits(w: FixtureWriter, mods: ProductionModules) {
	const v = mods.visit;

	const serializeCases: Array<{ name: string; visit: VisitInputJson }> = [
		{ name: '01-date-only', visit: { date: '2026-05-15', imagePaths: [] } },
		{
			name: '02-single-rating-full',
			visit: {
				date: '2026-05-15',
				meal: 'Lunch',
				companions: 'Sarah, Tom',
				vibe: 'Bright and busy',
				food: 'Lamb shoulder',
				quality: 'Tender',
				service: 'Friendly',
				rating: 4,
				notes: 'Loved it. Would come back.',
				imagePaths: [
					'_attachments/cumulus-inc/20260515-133000-1.jpg',
					'_attachments/cumulus-inc/20260515-133000-2.jpg'
				]
			}
		},
		{
			name: '03-per-area-full',
			visit: {
				date: '2026-05-18',
				meal: 'Dinner',
				vibe: 'Loud, fun',
				food: 'Pasta',
				quality: 'Sharp',
				service: 'Attentive',
				areaRatings: { vibe: 4, food: 5, quality: 5, service: 4 },
				notes: 'Even better the second time.',
				imagePaths: []
			}
		},
		{
			name: '04-per-area-partial-stars-only',
			visit: {
				date: '2026-05-19',
				areaRatings: { vibe: 3, food: null, quality: null, service: null },
				imagePaths: []
			}
		},
		{
			name: '05-dishes-no-ratings-bare-food-anchor',
			visit: {
				date: '2026-06-01',
				meal: 'Dinner',
				dishes: [
					{ name: 'Hand-cut pasta', rating: null, note: null, photoPath: null },
					{ name: 'Tiramisu', rating: null, note: 'shared', photoPath: null }
				],
				imagePaths: []
			}
		},
		{
			name: '06-dishes-full',
			visit: {
				date: '2026-06-02',
				meal: 'Dinner',
				companions: '[[Alex]]',
				areaRatings: { vibe: 4, food: null, quality: null, service: 3 },
				dishes: [
					{
						name: 'Wood-grilled octopus',
						rating: 5,
						note: 'best dish of the year',
						photoPath: '_attachments/etta/20260602-193000-d0.jpg'
					},
					{ name: 'Cavatelli', rating: 4, note: null, photoPath: null },
					{
						name: 'Basque cheesecake',
						rating: 4,
						note: 'em-dash — inside note',
						photoPath: '_attachments/etta/20260602-193000-d2.jpg'
					}
				],
				notes: 'Dish average should drive the Food rating.',
				imagePaths: ['_attachments/etta/20260602-193000-1.jpg']
			}
		},
		{
			name: '07-dishes-override-explicit-food-rating',
			visit: {
				date: '2026-06-03',
				areaRatings: { vibe: 3, food: 2, quality: 3, service: 3 },
				dishes: [
					{ name: 'Roast chicken', rating: 5, note: null, photoPath: null },
					{ name: 'Fries', rating: 4, note: null, photoPath: null }
				],
				imagePaths: []
			}
		},
		{
			name: '08-attribute-overrides',
			visit: {
				date: '2026-06-04',
				rating: 3,
				// serializeOverrides drops null/undefined values at runtime even
				// though VisitInput types the map more strictly — capture that.
				attributeOverrides: {
					dog_friendly: 'yes',
					sunday_lunch: 'no',
					'Needs Slugify': 'yes',
					ignored_null: null
				} as unknown as Record<string, import('../src/lib/attributes').AttributeValue>,
				imagePaths: []
			}
		},
		{
			name: '09-companions-wikilinks',
			visit: {
				date: '2026-06-05',
				companions: '[[Sarah]], [[Tom Marvolo]] and one more',
				notes: 'Notes can hold [[Wikilinks]] too.',
				imagePaths: []
			}
		},
		{
			name: '10-eight-photos',
			visit: {
				date: '2026-06-06',
				meal: 'Brunch',
				rating: 5,
				imagePaths: Array.from(
					{ length: 8 },
					(_, i) => `_attachments/cafe-slug/20260606-101500-${i + 1}.jpg`
				)
			}
		},
		{
			name: '11-no-rating-line',
			visit: {
				date: '2026-06-07',
				vibe: 'Fine',
				rating: null,
				areaRatings: { vibe: null, food: null, quality: null, service: null },
				imagePaths: []
			}
		},
		{
			name: '12-meal-with-em-dash',
			visit: { date: '2026-06-08', meal: 'Dinner — chef’s tasting', imagePaths: [] }
		},
		{
			name: '13-dish-name-trimming-and-empty-filtered',
			visit: {
				date: '2026-06-09',
				dishes: [
					{ name: '  padded name  ', rating: 3, note: '  padded note  ', photoPath: null },
					{ name: '', rating: null, note: null, photoPath: null },
					{ name: '', rating: null, note: null, photoPath: '_attachments/x/20260609-1-d1.jpg' }
				],
				imagePaths: []
			}
		},
		{
			name: '14-multiparagraph-notes',
			visit: {
				date: '2026-06-10',
				rating: 4,
				notes: 'First paragraph.\n\nSecond paragraph — with a dash.\n\n- a list item\n- another',
				imagePaths: []
			}
		},
		{
			name: '15-dish-average-rounding',
			visit: {
				date: '2026-06-11',
				dishes: [
					{ name: 'A', rating: 4, note: null, photoPath: null },
					{ name: 'B', rating: 4, note: null, photoPath: null },
					{ name: 'C', rating: 5, note: null, photoPath: null }
				],
				imagePaths: []
			}
		},
		{
			name: '16-unicode-fields',
			visit: {
				date: '2026-06-12',
				meal: 'Déjeuner',
				vibe: 'Très ★ chic — vraiment',
				companions: 'François, 東京より',
				notes: 'ラーメン 🍜 was great.',
				imagePaths: []
			}
		}
	];

	for (const c of serializeCases) {
		await w.json(`visits/serialize/${c.name}.json`, { name: c.name, visit: c.visit });
		await w.write(`visits/serialize/${c.name}.expected.md`, v.visitBlock(c.visit));
	}

	// --- parse ---------------------------------------------------------------

	const overviewPrefix = '## Overview\n\nA reliable spot.\n\n';
	const parseCases: Array<{ name: string; body: string }> = [
		{
			name: '01-single-rating',
			body:
				overviewPrefix +
				'## Visits\n\n### 2026-05-15 — Lunch\n\n**With:** Sarah, Tom  \n**Vibe:** Bright and busy  \n**Food:** Lamb shoulder  \n**Quality:** Tender  \n**Service:** Friendly  \n**Rating:** 4/5  \n\nLoved it. Would bring [[Friend]] next time.\n\n![](_attachments/cumulus-inc/20260515-133000-1.jpg)\n'
		},
		{
			name: '02-per-area-stars',
			body:
				overviewPrefix +
				'## Visits\n\n### 2026-05-18 — Dinner\n\n**Vibe:** ★★★★☆ — Loud, fun  \n**Food:** ★★★★★ — Pasta  \n**Quality:** ★★★★★  \n**Service:** ★★★★☆ — Attentive  \n**Rating:** 4.5/5 (avg)  \n\nEven better the second time.\n'
		},
		{
			name: '03-em-dash-vs-hyphen-headers',
			body:
				'## Visits\n\n### 2026-05-15 — Lunch\n\n**Rating:** 4/5  \n\n### 2026-05-16 - Dinner\n\n**Rating:** 3/5  \n'
		},
		{
			name: '04-date-only-and-non-date-headers',
			body: '## Visits\n\n### 2026-05-17\n\nJust notes, nothing structured.\n\n### Birthday dinner\n\nFree-form header, no date.\n'
		},
		{
			name: '05-dishes-full',
			body:
				'## Visits\n\n### 2026-06-02 — Dinner\n\n**With:** [[Alex]]  \n**Vibe:** ★★★★☆  \n**Food:**  \n- **Wood-grilled octopus** ★★★★★ — best dish of the year  \n  ![](_attachments/etta/20260602-193000-d0.jpg)\n- **Cavatelli** ★★★★\n- **Basque cheesecake** ★★★★ — em-dash — inside note  \n  ![](_attachments/etta/20260602-193000-d2.jpg)\n**Service:** ★★★☆☆  \n**Rating:** 4/5 (avg)  \n\nDish average drives the Food rating.\n\n![](_attachments/etta/20260602-193000-1.jpg)\n'
		},
		{
			name: '06-dishes-bare-food-anchor',
			body:
				'## Visits\n\n### 2026-06-01 — Dinner\n\n**Food:**  \n- **Hand-cut pasta**\n- **Tiramisu** — shared\n\nNo ratings on the dishes.\n'
		},
		{
			name: '07-attribute-override-variants',
			body:
				'## Visits\n\n### 2026-06-04\n\n**Rating:** 3/5  \n**Attributes:** dog_friendly=yes, sunday_lunch=no, loud=true, quiet=false, packed=1, empty_tables=0, reset=clear, junk, spaced = yes, CAPS=YES  \n'
		},
		{
			name: '08-notes-and-trailing-photos',
			body:
				'## Visits\n\n### 2026-06-05 — Dinner\n\n**Rating:** 4/5  \n\nFirst paragraph with [[Wikilink]].\n\nSecond paragraph.\n\n![](_attachments/spot/20260605-1.jpg)\n![](_attachments/spot/20260605-2.jpg)\n'
		},
		{
			name: '09-no-trailing-double-space',
			body: '## Visits\n\n### 2026-06-06\n**With:** Casual Writer\n**Vibe:** fine\n**Rating:** 3/5\nnotes right after\n'
		},
		{
			name: '10-unknown-bold-label-becomes-notes',
			body: '## Visits\n\n### 2026-06-07\n\n**Mood:** contemplative  \n**Rating:** 4/5  \n'
		},
		{
			name: '11-external-photo-not-in-photopaths',
			body:
				'## Visits\n\n### 2026-06-08\n\n**Rating:** 5/5  \n\n![](https://example.com/external.jpg)\n![](_attachments/spot/20260608-1.jpg)\n'
		},
		{ name: '12-empty-visits-section', body: '## Overview\n\nNothing yet.\n\n## Visits\n' },
		{
			name: '13-avg-marker-clears-single-rating',
			body: '## Visits\n\n### 2026-06-09\n\n**Rating:** 4.5/5 (avg)  \n\nOnly an avg line, no stars.\n'
		},
		{
			name: '14-kitchen-sink-summary',
			body:
				overviewPrefix +
				'## Visits\n\n### 2026-01-10 — Lunch\n\n**Rating:** 3/5  \n\n### 2026-02-20 — Dinner\n\n**Vibe:** ★★★★☆  \n**Food:** ★★★★★  \n**Rating:** 4.5/5 (avg)  \n\n![](_attachments/spot/20260220-1.jpg)\n\n### 2026-03-05\n\nNo rating at all here.\n\n## After Section\n\nKept out of the visits.\n'
		}
	];

	for (const c of parseCases) {
		const { visitsSection } = v.splitBodyAtVisits(c.body);
		const visits = v.parseVisits(visitsSection);
		const expected = {
			name: c.name,
			visits: visits.map((pv) => ({ ...pv, fields: v.parseVisitFields(pv) })),
			summary: v.summarizeVisits(visits)
		};
		await w.write(`visits/parse/${c.name}.md`, c.body);
		await w.json(`visits/parse/${c.name}.expected.json`, expected);
	}

	// --- body-ops (append / update / remove at index) --------------------------

	const opsBody =
		'## Overview\n\nA place.\n\n## Visits\n\n### 2026-05-01 — Lunch\n\n**Rating:** 3/5  \n\nolder notes\n\n### 2026-05-02 — Dinner\n\n**Rating:** 4/5  \n\nnewer notes\n';
	const appendVisit: VisitInputJson = {
		date: '2026-05-15',
		meal: 'Dinner',
		rating: 5,
		notes: 'appended',
		imagePaths: []
	};
	const replacementVisit: VisitInputJson = {
		date: '2026-05-01',
		meal: 'Lunch',
		vibe: 'replaced',
		imagePaths: []
	};
	const bodyOps = {
		description:
			'Body-level visit operations through the production functions. append = ' +
			'appendVisitToBody(body, visit); update = updateVisitInBody(body, index, visit); ' +
			'remove = removeVisitFromBody(body, index).',
		append: [
			{ name: 'append-to-existing-section', body: opsBody, visit: appendVisit, expected: v.appendVisitToBody(opsBody, appendVisit) },
			{
				name: 'append-creates-section',
				body: '## Overview\n\nA place.\n',
				visit: appendVisit,
				expected: v.appendVisitToBody('## Overview\n\nA place.\n', appendVisit)
			}
		],
		update: [
			{
				name: 'update-first',
				body: opsBody,
				index: 0,
				visit: replacementVisit,
				expected: v.updateVisitInBody(opsBody, 0, replacementVisit)
			},
			{
				name: 'update-last',
				body: opsBody,
				index: 1,
				visit: replacementVisit,
				expected: v.updateVisitInBody(opsBody, 1, replacementVisit)
			}
		],
		remove: [
			{ name: 'remove-first', body: opsBody, index: 0, expected: v.removeVisitFromBody(opsBody, 0) },
			{ name: 'remove-last', body: opsBody, index: 1, expected: v.removeVisitFromBody(opsBody, 1) },
			{
				name: 'remove-only-visit-keeps-header',
				body: '## Overview\nA spot.\n\n## Visits\n\n### 2026-05-15\n**Vibe:** ok  \nnotes\n',
				index: 0,
				expected: v.removeVisitFromBody(
					'## Overview\nA spot.\n\n## Visits\n\n### 2026-05-15\n**Vibe:** ok  \nnotes\n',
					0
				)
			}
		]
	};
	await w.json('visits/body-ops.json', bodyOps);

	return serializeCases.length + parseCases.length + 7;
}

/* -------------------------------------------------------------------------- */
/* Family: merge                                                               */
/* -------------------------------------------------------------------------- */

async function emitMerge(w: FixtureWriter, mods: ProductionModules) {
	const { threeWayMerge, conflictCopyPath } = mods.merge;
	type Doc = { frontmatter: Record<string, unknown>; body: string };
	const doc = (fm: Record<string, unknown>, body: string): Doc => ({ frontmatter: fm, body });

	const baseFm = {
		id: 'aaaa1111-bbbb-4222-8ccc-dddd3333eeee',
		schema_version: 1,
		name: 'Cumulus Inc',
		tags: ['wine'],
		rating: 4,
		custom_key: 'kept'
	};
	const baseBody = '## Overview\n\n## Visits\n';

	const cases: Array<{
		name: string;
		loaded: Doc;
		current: Doc;
		pending: Doc;
		dirtyFields: string[];
		bodyDirty: boolean;
	}> = [
		{
			name: '01-nothing-changed',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc({ ...baseFm }, baseBody),
			pending: doc({ ...baseFm }, baseBody),
			dirtyFields: [],
			bodyDirty: false
		},
		{
			name: '02-disk-field-change-taken',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc({ ...baseFm, rating: 5, suburb: 'Melbourne' }, baseBody),
			pending: doc({ ...baseFm }, baseBody),
			dirtyFields: [],
			bodyDirty: false
		},
		{
			name: '03-dirty-field-wins-over-disk',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc({ ...baseFm, name: 'Cumulus Inc. (Renamed on disk)' }, baseBody),
			pending: doc({ ...baseFm, name: 'Cumulus Up' }, baseBody),
			dirtyFields: ['name'],
			bodyDirty: false
		},
		{
			name: '04-dirty-key-removed-in-pending',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc({ ...baseFm }, baseBody),
			pending: doc(
				Object.fromEntries(Object.entries(baseFm).filter(([k]) => k !== 'rating')),
				baseBody
			),
			dirtyFields: ['rating'],
			bodyDirty: false
		},
		{
			name: '05-disk-deleted-key-stays-deleted',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc(
				Object.fromEntries(Object.entries(baseFm).filter(([k]) => k !== 'custom_key')),
				baseBody
			),
			pending: doc({ ...baseFm }, baseBody),
			dirtyFields: [],
			bodyDirty: false
		},
		{
			name: '06-disk-added-key-taken',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc({ ...baseFm, articles: [{ title: 'New review', url: 'https://example.com/r' }] }, baseBody),
			pending: doc({ ...baseFm }, baseBody),
			dirtyFields: [],
			bodyDirty: false
		},
		{
			name: '07-pending-adds-new-dirty-key',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc({ ...baseFm }, baseBody),
			pending: doc({ ...baseFm, attributes: { dog_friendly: 'yes' } }, baseBody),
			dirtyFields: ['attributes'],
			bodyDirty: false
		},
		{
			name: '08-body-dirty-only',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc({ ...baseFm }, baseBody),
			pending: doc({ ...baseFm }, baseBody + '\n### 2026-05-15\n\n**Rating:** 4/5  \n'),
			dirtyFields: [],
			bodyDirty: true
		},
		{
			name: '09-disk-body-change-taken',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc({ ...baseFm }, baseBody + '\n### 2026-05-16\n\n**Rating:** 5/5  \n'),
			pending: doc({ ...baseFm }, baseBody),
			dirtyFields: [],
			bodyDirty: false
		},
		{
			name: '10-body-conflict',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc({ ...baseFm, rating: 5 }, baseBody + '\ndisk edit\n'),
			pending: doc({ ...baseFm }, baseBody + '\napp edit\n'),
			dirtyFields: [],
			bodyDirty: true
		},
		{
			name: '11-mixed-field-and-body',
			loaded: doc({ ...baseFm }, baseBody),
			current: doc(
				{ ...baseFm, suburb: 'Fitzroy', tags: ['wine', 'late-night'] },
				baseBody + '\n### 2026-05-17\n\n**Rating:** 3/5  \n'
			),
			pending: doc({ ...baseFm, rating: 4.5, notes_key: 'added by app' }, baseBody),
			dirtyFields: ['rating', 'notes_key'],
			bodyDirty: false
		}
	];

	for (const c of cases) {
		const result = threeWayMerge({
			loaded: c.loaded as never,
			current: c.current as never,
			pending: c.pending as never,
			dirtyFields: c.dirtyFields,
			bodyDirty: c.bodyDirty
		});
		const expected =
			result.kind === 'clean'
				? { kind: 'clean', frontmatter: tagged(result.frontmatter), body: result.body }
				: {
						kind: 'conflict',
						reason: result.reason,
						current: {
							frontmatter: tagged(result.current.frontmatter),
							body: result.current.body
						}
					};
		await w.json(`merge/${c.name}.json`, {
			name: c.name,
			input: {
				loaded: { frontmatter: tagged(c.loaded.frontmatter), body: c.loaded.body },
				current: { frontmatter: tagged(c.current.frontmatter), body: c.current.body },
				pending: { frontmatter: tagged(c.pending.frontmatter), body: c.pending.body },
				dirtyFields: c.dirtyFields,
				bodyDirty: c.bodyDirty
			},
			expected
		});
	}

	const conflictPathCases = [
		{ filePath: 'Restaurants/Cumulus Inc.md', nowIso: '2026-07-17T09:30:00.000Z' },
		{ filePath: 'Restaurants/Vue de Monde (2).md', nowIso: '2026-12-31T23:59:59.999Z' },
		{ filePath: 'Restaurants/Late Night.md', nowIso: '2026-07-17T20:30:00+10:00' },
		{ filePath: 'Restaurants/notes.txt', nowIso: '2026-07-17T09:30:00.000Z' },
		{ filePath: 'Restaurants/Dot.Named.Place.md', nowIso: '2026-01-02T00:00:00.000Z' },
		{
			filePath: 'Restaurants/Cumulus Inc (conflict 2026-01-01).md',
			nowIso: '2026-07-17T09:30:00.000Z'
		}
	].map((c) => ({
		...c,
		expected: conflictCopyPath(c.filePath, new Date(c.nowIso))
	}));
	await w.json('merge/conflict-copy-paths.json', {
		description:
			'conflictCopyPath(filePath, now) cases. nowIso is parsed as a JS Date; the stamp is ' +
			'the UTC date (toISOString().slice(0, 10)).',
		cases: conflictPathCases
	});

	return cases.length + conflictPathCases.length;
}

/* -------------------------------------------------------------------------- */
/* Family: filenames                                                           */
/* -------------------------------------------------------------------------- */

async function emitFilenames(w: FixtureWriter, mods: ProductionModules) {
	const { sanitizeFilename, resolveCollisionFreePath } = mods.filename;
	const { slugFromFilePath } = mods.visit;
	const { slugifyLabel, uniqueAttributeId } = mods.attributes;
	const { restaurantsDir } = mods.config;

	const dir = restaurantsDir();

	const collisionInputs: Array<{ name: string; suburb: string | null; taken: string[] }> = [
		{ name: 'Cumulus Inc', suburb: 'Melbourne', taken: [] },
		{ name: 'Cumulus Inc', suburb: 'Melbourne', taken: ['Cumulus Inc.md'] },
		{
			name: 'Cumulus Inc',
			suburb: 'Melbourne',
			taken: ['Cumulus Inc.md', 'Cumulus Inc (Melbourne).md']
		},
		{ name: 'Cumulus Inc', suburb: null, taken: ['Cumulus Inc.md'] },
		{
			name: 'Cumulus Inc',
			suburb: null,
			taken: ['Cumulus Inc.md', 'Cumulus Inc (2).md', 'Cumulus Inc (3).md']
		},
		{
			name: 'Cumulus Inc',
			suburb: 'Fitzroy',
			taken: ['Cumulus Inc.md', 'Cumulus Inc (Fitzroy).md', 'Cumulus Inc (2).md']
		},
		{ name: 'Bar: The "Best" <Ever>?', suburb: null, taken: [] },
		{ name: 'Slash/Back\\Pipe|Star*', suburb: 'Q?', taken: ['SlashBackPipeStar.md'] },
		{ name: '***', suburb: null, taken: [] },
		{ name: '***', suburb: null, taken: ['Restaurant.md'] },
		{ name: '  Spaced   Out  ', suburb: null, taken: [] },
		{ name: 'Café Höhe — Süd', suburb: 'St Kilda', taken: ['Café Höhe — Süd.md'] }
	];

	const collision: Array<Record<string, unknown>> = [];
	for (const c of collisionInputs) {
		await rm(dir, { recursive: true, force: true });
		await mkdir(dir, { recursive: true });
		for (const t of c.taken) await writeFile(path.join(dir, t), 'taken\n', 'utf8');
		const resolved = await resolveCollisionFreePath(c.name, c.suburb);
		if (path.dirname(resolved) !== dir) {
			throw new Error(`resolveCollisionFreePath escaped the restaurants dir: ${resolved}`);
		}
		collision.push({ ...c, expected: path.basename(resolved) });
	}
	await rm(dir, { recursive: true, force: true });

	const sanitize = [
		'Cumulus Inc',
		'Bar: The "Best" <Ever>?',
		'Slash/Back\\Pipe|Star*',
		'   leading and trailing   ',
		'multi   internal    spaces',
		'***',
		'',
		'Café Höhe — Süd',
		'Tab\there',
		'dots.are.kept.md'
	].map((input) => ({ input, expected: sanitizeFilename(input) }));

	const fileSlugs = [
		'/vault/Restaurants/Cumulus Inc.md',
		'/x/Vue de Monde (Fitzroy).md',
		'Restaurants/Café Höhe — Süd.md',
		'Restaurants/日本食堂.md',
		"Restaurants/L'Hôtel: The \"Best\" Bar.md",
		'Restaurants/--- Weird --- Name ---.md',
		'Restaurants/UPPER case MiXeD.md',
		'Restaurants/1800-Pizza!.md',
		'Restaurants/☆★☆.md',
		'Restaurants/a.md'
	].map((filePath) => ({ filePath, expected: slugFromFilePath(filePath) }));

	const attributeSlugs = [
		'Dog Friendly',
		'dog_friendly',
		'Crème brûlée',
		'  padded  ',
		'ALL CAPS!',
		'24 Hour',
		'★ starred ★',
		'---',
		'multi -- dash',
		''
	].map((input) => ({ input, expected: slugifyLabel(input) }));

	const uniqueIds = [
		{ label: 'Dog Friendly', existing: [] as string[] },
		{ label: 'Dog Friendly', existing: ['dog_friendly'] },
		{ label: 'Dog Friendly', existing: ['dog_friendly', 'dog_friendly_2'] },
		{ label: '★★★', existing: ['attribute', 'attribute_2', 'attribute_3'] }
	].map((c) => ({ ...c, expected: uniqueAttributeId(c.label, c.existing) }));

	await w.json('filenames/cases.json', {
		description:
			'Filename + slug conventions. collision: resolveCollisionFreePath(name, suburb) with ' +
			'`taken` filenames already existing in the Restaurants dir — expected is the resolved ' +
			'basename. sanitize: sanitizeFilename. fileSlugs: slugFromFilePath (attachment dir ' +
			'slugs). attributeSlugs: slugifyLabel. uniqueAttributeIds: uniqueAttributeId(label, existing).',
		collision,
		sanitize,
		fileSlugs,
		attributeSlugs,
		uniqueAttributeIds: uniqueIds
	});

	return collisionInputs.length + sanitize.length + fileSlugs.length + attributeSlugs.length + uniqueIds.length;
}

/* -------------------------------------------------------------------------- */
/* Family: moc                                                                 */
/* -------------------------------------------------------------------------- */

async function emitMoc(w: FixtureWriter, mods: ProductionModules) {
	const { writeMocForList, createEmptyListMoc, setListMetadata } = mods.moc;
	const { upsertRestaurant } = mods.queries;
	const { getDb } = mods.schema;
	const { listsDir, restaurantsDir } = mods.config;

	type MocCase = {
		name: string;
		list_name: string;
		restaurant_names: string[];
		created_manually: boolean;
		meta: { notes?: string; icon?: string; source_url?: string; imported_at?: string } | null;
	};

	const cases: MocCase[] = [
		{
			name: '01-simple-list',
			list_name: 'Date Night',
			// Deliberately unsorted input; production orders by name COLLATE NOCASE.
			restaurant_names: ['marion', 'Cumulus Inc', 'Etta'],
			created_manually: false,
			meta: null
		},
		{
			name: '02-empty-manual-list',
			list_name: 'Someday',
			restaurant_names: [],
			created_manually: true,
			meta: null
		},
		{
			name: '03-with-metadata',
			list_name: 'Broadsheet Hit List',
			restaurant_names: ['Bar Liberty', 'Étta Unicode'],
			created_manually: false,
			meta: {
				notes: 'Imported picks — check seasonal closures.',
				icon: '🍷',
				source_url:
					'https://www.broadsheet.com.au/melbourne/food-and-drink/article/hit-list-very-long-url-that-will-exceed-eighty-characters-for-sure',
				imported_at: '2026-07-01T10:30:00.000Z'
			}
		},
		{
			name: '04-manual-with-restaurants',
			list_name: 'Weeknight',
			restaurant_names: ['Neighbourhood Wine', 'Kazuki'],
			created_manually: true,
			meta: null
		},
		{
			name: '05-ambiguous-list-name',
			list_name: 'Yes',
			restaurant_names: ['Affirmative Diner'],
			created_manually: false,
			meta: null
		},
		{
			name: '06-unicode-list-name',
			list_name: 'Décembre ★',
			restaurant_names: ['Zed', 'Ápero', 'brunswick spot'],
			created_manually: false,
			meta: null
		}
	];

	const results: Array<{ input: MocCase; expected: string }> = [];
	let caseIndex = 0;
	for (const c of cases) {
		// Reset scratch state (DB rows + MOC files) so each case is independent.
		const db = getDb();
		db.exec(
			'DELETE FROM restaurants_fts; DELETE FROM tags; DELETE FROM lists; DELETE FROM article_urls; DELETE FROM restaurants;'
		);
		await rm(listsDir(), { recursive: true, force: true });
		await mkdir(restaurantsDir(), { recursive: true });

		if (c.created_manually) {
			// Production lifecycle: the shell exists before any restaurants join.
			await createEmptyListMoc(c.list_name);
		}
		c.restaurant_names.forEach((name, i) => {
			const body = '## Overview\n\n## Visits\n';
			upsertRestaurant({
				frontmatter: {
					id: `00000000-0000-4000-8000-${String(caseIndex).padStart(4, '0')}${String(i).padStart(8, '0')}`,
					schema_version: 1,
					name,
					lists: [c.list_name]
				},
				body,
				rawContent: body,
				filePath: path.join(restaurantsDir(), `${name}.md`),
				mtime: 1000 + i,
				sha256: 'f'.repeat(64)
			});
		});
		if (c.restaurant_names.length > 0) await writeMocForList(c.list_name);
		if (c.meta) await setListMetadata(c.list_name, c.meta);

		const bytes = await readFile(path.join(listsDir(), `${c.list_name}.md`), 'utf8');
		results.push({ input: c, expected: bytes });
		caseIndex++;
	}

	for (const r of results) {
		await w.json(`moc/${r.input.name}.json`, {
			name: r.input.name,
			list_name: r.input.list_name,
			restaurant_names: r.input.restaurant_names,
			created_manually: r.input.created_manually,
			meta: r.input.meta
		});
		await w.write(`moc/${r.input.name}.expected.md`, r.expected);
	}
	return cases.length;
}

/* -------------------------------------------------------------------------- */
/* Family: documents                                                           */
/* -------------------------------------------------------------------------- */

function buildDocumentExpected(mods: ProductionModules, content: string) {
	const { parse, stringify } = mods.frontmatter;
	const v = mods.visit;
	const { frontmatter, body } = parse(content);
	const { visitsSection } = v.splitBodyAtVisits(body);
	const visits = v.parseVisits(visitsSection);
	return {
		expected: {
			frontmatter: tagged(frontmatter),
			body,
			visits: visits.map((pv) => ({ ...pv, fields: v.parseVisitFields(pv) })),
			summary: v.summarizeVisits(visits)
		},
		reemit: stringify(frontmatter as never, body)
	};
}

async function emitDocuments(w: FixtureWriter, mods: ProductionModules) {
	const { stringify } = mods.frontmatter;
	const v = mods.visit;

	// 01: exactly what the web app would write (frontmatter via production
	// stringify, visits via production visitBlock) — reemit must equal source.
	const webVisit1 = v.visitBlock({
		date: '2026-05-15',
		meal: 'Lunch',
		companions: 'Sarah, Tom',
		vibe: 'Bright and busy',
		food: 'Lamb shoulder',
		rating: 4,
		notes: 'Loved it. Would bring [[Friend]] next time.',
		imagePaths: ['_attachments/cumulus-inc/20260515-133000-1.jpg']
	});
	const webVisit2 = v.visitBlock({
		date: '2026-05-18',
		meal: 'Dinner',
		vibe: 'Loud, fun',
		food: 'Pasta',
		areaRatings: { vibe: 4, food: 5, quality: 5, service: 4 },
		dishes: [
			{
				name: 'Wood-grilled octopus',
				rating: 5,
				note: 'get two',
				photoPath: '_attachments/cumulus-inc/20260518-193000-d0.jpg'
			},
			{ name: 'Cavatelli', rating: 4, note: null, photoPath: null }
		],
		attributeOverrides: { dog_friendly: 'yes' },
		notes: 'Even better the second time.',
		imagePaths: []
	});
	const webBody =
		'## Overview\n\nGoogle: ★ 4.6 (2,113 reviews)\n\n## Menu\n\n- [Online menu](https://cumulusinc.com.au/menus/)\n\n## Visits\n\n' +
		webVisit1 +
		'\n' +
		webVisit2;
	const webDoc = stringify(
		{
			id: '4b3a2c1d-0e9f-4a51-8e0f-aa4a3b2c1d0e',
			schema_version: 1,
			name: 'Cumulus Inc',
			address: '45 Flinders Ln, Melbourne VIC 3000, Australia',
			suburb: 'Melbourne',
			lat: -37.8148096,
			lng: 144.9704353,
			phone: '+61 3 9650 1445',
			website: 'https://cumulusinc.com.au/',
			hours: { mon: '7:00 am – 11:00 pm', sun: 'Closed' },
			cuisine: ['Modern Australian'],
			price_level: 3,
			place_ids: { google: 'ChIJwYCC5spC1moRZ3TV4zNAfDo' },
			lists: ['Date Night'],
			tags: ['wine'],
			rating: 4.5,
			attributes: { dog_friendly: 'yes' },
			last_synced: '2026-07-01T10:30:00.000Z'
		} as never,
		webBody
	);

	const cases: Array<{ name: string; content: string }> = [
		{ name: '01-web-written-full', content: webDoc },
		{
			name: '02-blank-created',
			content: stringify(
				{
					id: '99998888-7777-4666-8555-444433332222',
					schema_version: 1,
					name: 'Corner Noodles',
					suburb: 'Brunswick',
					lists: [],
					tags: [],
					last_synced: '2026-07-10T02:15:00.000Z'
				} as never,
				'## Overview\n\n## Visits\n'
			)
		},
		{
			name: '03-unknown-keys-and-articles',
			content:
				'---\nid: 11112222-3333-4444-8555-666677778888\nschema_version: 1\nname: Etta\narticles:\n  - title: The 38 essential restaurants you absolutely must visit in Melbourne before the end of the decade\n    url: https://www.broadsheet.com.au/melbourne/food-and-drink/article/38-essential\n    source: broadsheet\n    published: 2024-11-02\nmy_custom_rank: 2\nfavourite_dish: hand-rolled cavatelli\n---\n## Overview\n\n## Press\n\nUnknown body sections must survive round-trips untouched.\n\n## Visits\n\n### 2026-03-01 — Dinner\n\n**Rating:** 4/5  \n'
		},
		{
			name: '04-legacy-unquoted-values',
			content:
				'---\nid: aaaa1111-bbbb-4222-8ccc-dddd3333eeee\nschema_version: 1\nname: Old Timer\nrating: 4\nattributes:\n  dog_friendly: yes\n  sunday_lunch: no\nlast_synced: 2026-07-01T10:30:00Z\nopened: 2001-12-14\n---\n## Overview\n\n## Visits\n'
		},
		{
			name: '05-no-frontmatter',
			content: '# Handwritten Note\n\nSomeone dropped a plain markdown file into the vault.\n\n## Visits\n\n### 2026-04-04\n\nStill parses as a visit.\n'
		},
		{
			name: '06-frontmatter-only',
			content: '---\nid: 6c6c6c6c-7d7d-4e8e-8f9f-0a0a0a0a0a0a\nname: Header Only\n---\n'
		},
		{
			name: '07-obsidian-external-edits',
			content:
				'---\nid: 5f5f5f5f-6a6a-4b7b-8c8c-9d9d9d9d9d9d\nname: Scribbled On\ntags: [quick, flow-style]\nrating: 3.5\n---\n## Overview\n\nUser prose with **bold**, [links](https://example.com) and [[Wikilinks]].\n\n> [!note] An Obsidian callout\n> with a second line\n\n## Visits\n\n### 2026-02-14 — Date night\n\n**Vibe:** ★★★☆☆ — cosy  \n**Rating:** 3/5 (avg)  \n\nShared the tasting menu.\n\n## Scratchpad\n\n- [ ] try the bar seats\n- [x] book for birthday\n\t- indented with a tab\n'
		}
	];

	for (const c of cases) {
		const { expected, reemit } = buildDocumentExpected(mods, c.content);
		await w.write(`documents/${c.name}.md`, c.content);
		await w.json(`documents/${c.name}.expected.json`, { name: c.name, ...expected });
		await w.write(`documents/${c.name}.reemit.md`, reemit);
	}
	return cases.length;
}

/* -------------------------------------------------------------------------- */
/* Family: fuzz                                                                */
/* -------------------------------------------------------------------------- */

const FUZZ_WORDS = [
	'wine',
	'bar',
	'noodle',
	'grill',
	'café',
	'ştar',
	'pizza',
	'ramen',
	'bistro',
	'yes',
	'no',
	'on',
	'null',
	'true',
	'2026-01-01',
	'12:30',
	'★★★☆☆',
	'—',
	'#tag',
	"o'clock",
	'a:b',
	'x'.repeat(90),
	'trailing ',
	' leading'
] as const;

function fuzzString(rng: Rng): string {
	const kind = randInt(rng, 10);
	if (kind === 0) return pick(rng, AMBIGUOUS_STRINGS);
	if (kind === 1) return '';
	if (kind === 2) {
		// multiline
		const lines = 1 + randInt(rng, 4);
		const parts: string[] = [];
		for (let i = 0; i < lines; i++) parts.push(pick(rng, FUZZ_WORDS));
		let s = parts.join('\n');
		if (chance(rng, 0.3)) s += '\n';
		if (chance(rng, 0.15)) s += '\n';
		return s;
	}
	if (kind === 3) {
		// long string with/without break opportunities
		const word = pick(rng, ['x', 'word ', 'https://ex.am/', 'ab—', '★']);
		return word.repeat(20 + randInt(rng, 20)).trim();
	}
	// word soup
	const words = 1 + randInt(rng, 8);
	const parts: string[] = [];
	for (let i = 0; i < words; i++) parts.push(pick(rng, FUZZ_WORDS));
	return parts.join(' ');
}

function fuzzNumber(rng: Rng): number {
	const kind = randInt(rng, 6);
	if (kind === 0) return randInt(rng, 6);
	if (kind === 1) return (5 + randInt(rng, 46)) / 10;
	if (kind === 2) return -37 + rng();
	if (kind === 3) return u32(rng);
	if (kind === 4) return randomDouble(rng);
	return u32(rng) / 1000;
}

function fuzzScalar(rng: Rng): unknown {
	const kind = randInt(rng, 10);
	if (kind < 5) return fuzzString(rng);
	if (kind < 8) return fuzzNumber(rng);
	if (kind === 8) return chance(rng, 0.5);
	return null;
}

function fuzzKey(rng: Rng, i: number): string {
	const base = pick(rng, ['extra', 'custom', 'x', 'note', 'meta', 'field'] as const);
	return `${base}_${i}_${String.fromCharCode(97 + randInt(rng, 26))}`;
}

function fuzzTree(rng: Rng, depth: number): unknown {
	if (depth <= 0) return fuzzScalar(rng);
	const kind = randInt(rng, 10);
	if (kind < 6) return fuzzScalar(rng);
	if (kind < 8) {
		const n = randInt(rng, 4);
		const out: unknown[] = [];
		for (let i = 0; i < n; i++) out.push(fuzzTree(rng, depth - 1));
		return out;
	}
	const n = randInt(rng, 4);
	const out: Record<string, unknown> = {};
	for (let i = 0; i < n; i++) out[fuzzKey(rng, i)] = fuzzTree(rng, depth - 1);
	return out;
}

function fuzzIso(rng: Rng): string {
	const y = 2020 + randInt(rng, 7);
	const mo = 1 + randInt(rng, 12);
	const d = 1 + randInt(rng, 28);
	const h = randInt(rng, 24);
	const mi = randInt(rng, 60);
	const s = randInt(rng, 60);
	const pad = (n: number) => String(n).padStart(2, '0');
	const base = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;
	return chance(rng, 0.5) ? `${base}.000Z` : `${base}Z`;
}

function fuzzUuid(rng: Rng): string {
	const hex = () => u32(rng).toString(16).padStart(8, '0');
	const raw = hex() + hex() + hex() + hex();
	return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-8${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}

function fuzzFrontmatter(rng: Rng): Record<string, unknown> {
	const fm: Record<string, unknown> = {};
	const maybe = (p: number, key: string, make: () => unknown) => {
		if (chance(rng, p)) fm[key] = make();
	};
	maybe(0.9, 'id', () => fuzzUuid(rng));
	maybe(0.9, 'schema_version', () => 1);
	maybe(0.95, 'name', () => fuzzString(rng));
	maybe(0.3, 'aliases', () => {
		const n = randInt(rng, 3);
		return Array.from({ length: n }, () => fuzzString(rng));
	});
	maybe(0.5, 'address', () => `${1 + randInt(rng, 400)} ${pick(rng, FUZZ_WORDS)} St, Melbourne VIC 3000`);
	maybe(0.5, 'suburb', () => pick(rng, ['Fitzroy', 'CBD', 'ON', 'no', 'Brunswick East'] as const));
	maybe(0.6, 'lat', () => fuzzNumber(rng));
	maybe(0.6, 'lng', () => fuzzNumber(rng));
	maybe(0.4, 'phone', () => `+61 3 ${1000 + randInt(rng, 9000)} ${1000 + randInt(rng, 9000)}`);
	maybe(0.4, 'website', () =>
		chance(rng, 0.3) ? LONG_URL : `https://example.com/${pick(rng, FUZZ_WORDS)}`
	);
	maybe(0.25, 'socials', () => {
		const out: Record<string, unknown> = {};
		if (chance(rng, 0.8)) out.instagram = `https://www.instagram.com/${fuzzKey(rng, 0)}/`;
		if (chance(rng, 0.3)) out.facebook = `https://www.facebook.com/${fuzzKey(rng, 1)}`;
		return out;
	});
	maybe(0.3, 'hours', () => {
		const out: Record<string, unknown> = {};
		for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
			if (chance(rng, 0.7)) {
				out[day] = chance(rng, 0.2)
					? 'Closed'
					: `${1 + randInt(rng, 11)}:00 am – ${1 + randInt(rng, 11)}:00 pm`;
			}
		}
		return out;
	});
	maybe(0.5, 'cuisine', () => [pick(rng, ['Italian', 'Japanese', 'Wine Bar', 'Café'] as const)]);
	maybe(0.4, 'price_level', () => 1 + randInt(rng, 4));
	maybe(0.5, 'place_ids', () => ({ google: `ChIJ${fuzzUuid(rng).replace(/-/g, '').slice(0, 20)}` }));
	maybe(0.7, 'lists', () => {
		const n = randInt(rng, 3);
		return Array.from({ length: n }, () => pick(rng, ['Date Night', 'CBD Lunch', 'Someday', '★ Favourites'] as const));
	});
	maybe(0.2, 'list_memberships', () => [
		{ list: 'Date Night', notes: fuzzString(rng) }
	]);
	maybe(0.6, 'tags', () => {
		const n = randInt(rng, 4);
		return Array.from({ length: n }, () => pick(rng, ['wine', 'brunch', 'late-night', 'yes'] as const));
	});
	maybe(0.5, 'rating', () => (5 + randInt(rng, 46)) / 10);
	maybe(0.5, 'attributes', () => {
		const out: Record<string, unknown> = {};
		for (const id of ['dog_friendly', 'sunday_lunch', 'y', 'open_late']) {
			if (chance(rng, 0.5)) out[id] = chance(rng, 0.5) ? 'yes' : 'no';
		}
		return out;
	});
	maybe(0.7, 'last_synced', () => fuzzIso(rng));
	const unknownCount = randInt(rng, 4);
	for (let i = 0; i < unknownCount; i++) {
		fm[fuzzKey(rng, i)] = fuzzTree(rng, 2);
	}
	return fm;
}

const FUZZ_BODIES = [
	'',
	'## Overview\n\n## Visits\n',
	'## Overview\n\nA place — with ★ notes.\n\n## Visits\n\n### 2026-01-05 — Dinner\n\n**Rating:** 4/5  \n',
	'body without headings\n',
	'## Overview\n\nGoogle: ★ 4.6 (1,234 reviews)\n\n## Menu\n\n- [Online menu](https://example.com/menu)\n\n## Visits\n'
] as const;

async function emitFuzz(w: FixtureWriter, mods: ProductionModules) {
	const { stringify } = mods.frontmatter;
	const rng = mulberry32(FUZZ_SEED);
	const lines: string[] = [];
	for (let i = 0; i < FUZZ_CASES; i++) {
		const fm = fuzzFrontmatter(rng);
		const body = pick(rng, FUZZ_BODIES);
		const expected = stringify(fm as never, body);
		lines.push(JSON.stringify({ i, frontmatter: tagged(fm), body, expected }));
	}
	await w.write('fuzz/corpus.ndjson', lines.join('\n') + '\n');
	return FUZZ_CASES;
}

/* -------------------------------------------------------------------------- */
/* README                                                                      */
/* -------------------------------------------------------------------------- */

async function emitReadme(w: FixtureWriter) {
	const { grayMatter: grayMatterVersion, jsYaml: jsYamlVersion } = await emissionDepVersions();

	const readme = `# Golden fixtures

Cross-language golden fixtures for the Restauranteer vault file format. They pin
the exact behavior of the production web modules (gray-matter ${grayMatterVersion} /
js-yaml ${jsYamlVersion} emission included) so a Swift port (\`VaultFormat\`) can be
tested against the very same bytes. **Do not edit anything in this tree by
hand** — it is generated.

## Regenerating

\`\`\`sh
pnpm export-fixtures
\`\`\`

That runs \`scripts/export-fixtures.ts\` via plain Node (type stripping) with
\`scripts/fixtures-loader.mjs\` mapping the SvelteKit-only import specifiers.
The exporter imports the production modules unmodified:

- \`src/lib/server/vault/frontmatter.ts\` (gray-matter parse/stringify + date normalization)
- \`src/lib/server/vault/visit.ts\` (visit block serialize/parse/summaries + body ops)
- \`src/lib/server/vault/merge.ts\` (three-way merge + conflict-copy naming)
- \`src/lib/server/vault/filename.ts\` (sanitize + collision resolution)
- \`src/lib/server/vault/moc.ts\` (list MOC generation, run against a scratch vault + SQLite index)
- \`src/lib/attributes.ts\` (attribute-override line serializer + slugs)

Everything is deterministic (fixed PRNG seeds, no timestamps, no absolute
paths). \`tests/fixtures-export.test.ts\` regenerates the tree on every test run
and fails on any byte difference, so a change in the web format shows up as a
reviewable fixture diff. If that test fails: run \`pnpm export-fixtures\`, review
the diff, commit it, and update the Swift side to match.

## Tagged-scalar JSON encoding

JSON cannot faithfully carry YAML value trees (int/float with equal value,
-0, NaN/Infinity, key order), so wherever fixture JSON contains YAML values
they are encoded as tagged objects:

| Tag | Shape | Notes |
| --- | --- | --- |
| \`null\` | \`{"t":"null"}\` | |
| \`bool\` | \`{"t":"bool","v":true}\` | |
| \`int\` | \`{"t":"int","v":"4"}\` | \`v\` is a decimal string. Used iff the JS number is a safe integer and not \`-0\`. |
| \`float\` | \`{"t":"float","v":"4.5","bitsHex":"4012000000000000"}\` | \`v\` is ECMA-262 \`String(n)\`; \`bitsHex\` is the exact IEEE-754 double, big-endian hex — reconstruct the number from \`bitsHex\`. |
| \`str\` | \`{"t":"str","v":"text"}\` | |
| \`arr\` | \`{"t":"arr","v":[…]}\` | Elements are tagged values. |
| \`map\` | \`{"t":"map","v":[["key", …], …]}\` | Ordered \`[key, value]\` pairs — order is the emission order and MUST be preserved. |

Plain (untagged) JSON is used where values are typed structs rather than YAML
trees (visit inputs/fields, merge metadata, filenames, MOC inputs).

## Families

| Path | Contents |
| --- | --- |
| \`frontmatter/serialize/*.json\` → \`*.expected.md\` | \`{frontmatter: tagged, body}\` → full file bytes from the production serializer. |
| \`frontmatter/parse/*.md\` → \`*.expected.json\` | file bytes → \`{frontmatter: tagged, body}\` from the production parser (YAML dates already normalized to ISO strings). |
| \`yaml-scalars/scalars.json\` | string quoting/folding torture set; each case emitted in a flat and a nested context (full document bytes). |
| \`numbers/doubles.json\` | curated + seeded-random doubles: IEEE-754 \`bitsHex\`, ECMA-262 \`js\` string, and emission bytes at two indent levels. |
| \`visits/serialize/*.json\` → \`*.expected.md\` | \`VisitInput\` JSON → \`visitBlock()\` bytes. |
| \`visits/parse/*.md\` → \`*.expected.json\` | body bytes → parsed visits (raw blocks + fields) + summary. |
| \`visits/body-ops.json\` | append/update-at/remove-at body transformations. |
| \`merge/*.json\` | three-way merge cases (\`loaded/current/pending/dirtyFields/bodyDirty\` → \`MergeResult\`); \`conflict-copy-paths.json\` for conflict-copy naming. |
| \`filenames/cases.json\` | collision-free path resolution, filename sanitization, attachment-dir slugs, attribute-id slugs. |
| \`moc/*.json\` → \`*.expected.md\` | list-MOC state → generated file bytes (sentinel frontmatter + wikilink body). |
| \`documents/*.md\` → \`*.expected.json\` + \`*.reemit.md\` | full realistic files → parse result AND parse→stringify bytes (\`01-web-written-full\` is a serializer fixed point). |
| \`fuzz/corpus.ndjson\` | ${FUZZ_CASES} seeded-PRNG cases (seed \`0x${FUZZ_SEED.toString(16)}\`), one JSON object per line: \`{i, frontmatter: tagged, body, expected}\`. |

## Format conventions worth knowing (captured by these fixtures)

- Emission is js-yaml ${jsYamlVersion} defaults: 2-space indent, 80-column line
  width with \`>-\` folding, single quotes for YAML-1.1-ambiguous scalars
  (\`'yes'\`, \`'no'\`, \`'y'\`, ISO timestamps, number-looking strings), \`|-\`/\`|\`/\`|+\`
  literal blocks for multiline strings, double quotes only when escapes are
  required (astral unicode emits \`\\U0001F35C\`-style escapes).
- Numbers: integer-valued doubles emit \`String(n)\` (so \`1e21\` → \`1e+21\`);
  non-integers get a \`.e\` fix-up (\`1e-7\` → \`1.e-7\`); \`-0\` → \`-0.0\`;
  \`NaN/±Infinity\` → \`.nan/.inf/-.inf\`.
- An empty frontmatter map emits no \`---\` block at all; the body always gains a
  trailing newline if missing.
- Visit blocks: \`### YYYY-MM-DD — Meal\` headers (em-dash), bold labels with
  two trailing spaces (hard line breaks), literal \`★\`/\`☆\` stars, dish bullets
  with indented photo lines, \`**Rating:** X/5 (avg)\` when derived from areas.
`;
	await w.write('README.md', readme);
	return 1;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export type ExportManifest = {
	outRoot: string;
	fileCounts: Record<string, number>;
	caseCounts: Record<string, number>;
	totalFiles: number;
};

export async function exportFixtures(outRoot: string): Promise<ExportManifest> {
	const { mods, scratch } = await loadProduction();
	await rm(outRoot, { recursive: true, force: true });
	await mkdir(outRoot, { recursive: true });

	const w = new FixtureWriter(outRoot, [scratch, os.tmpdir() + path.sep]);
	const caseCounts: Record<string, number> = {};
	caseCounts['frontmatter/serialize'] = await emitFrontmatterSerialize(w, mods);
	caseCounts['frontmatter/parse'] = await emitFrontmatterParse(w, mods);
	caseCounts['yaml-scalars'] = await emitYamlScalars(w, mods);
	caseCounts['numbers'] = await emitNumbers(w, mods);
	caseCounts['visits'] = await emitVisits(w, mods);
	caseCounts['merge'] = await emitMerge(w, mods);
	caseCounts['filenames'] = await emitFilenames(w, mods);
	caseCounts['moc'] = await emitMoc(w, mods);
	caseCounts['documents'] = await emitDocuments(w, mods);
	caseCounts['fuzz'] = await emitFuzz(w, mods);
	await emitReadme(w);

	const fileCounts = Object.fromEntries([...w.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
	return {
		outRoot,
		fileCounts,
		caseCounts,
		totalFiles: [...w.counts.values()].reduce((a, b) => a + b, 0)
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
	const outRoot = path.join(ROOT, 'fixtures');
	try {
		const manifest = await exportFixtures(outRoot);
		console.log(`Exported ${manifest.totalFiles} fixture files to ${path.relative(ROOT, outRoot)}/`);
		for (const [family, count] of Object.entries(manifest.fileCounts)) {
			console.log(`  ${family.padEnd(24)} ${count} file${count === 1 ? '' : 's'}`);
		}
	} finally {
		await cleanupScratch();
	}
}

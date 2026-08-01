/**
 * End-to-end exercise of the sync endpoints against a scratch vault: the real
 * route handlers, the real atomic writer, the real SQLite index.
 *
 * The auth guard lives in `hooks.server.ts` and is covered by auth.test.ts —
 * these call the handlers directly, i.e. as an already-authorised request.
 *
 * `config.ts` snapshots VAULT_PATH at import time, so every production module
 * is imported dynamically after the scratch vault is configured.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

type Handler = (event: RequestEvent) => Promise<Response> | Response;

type Modules = {
	fileGET: Handler;
	filePUT: Handler;
	fileDELETE: Handler;
	manifestGET: Handler;
	infoGET: Handler;
	queries: typeof import('../../src/lib/server/db/queries');
	schema: typeof import('../../src/lib/server/db/schema');
	tombstones: typeof import('../../src/lib/server/sync/tombstones');
	vaultId: typeof import('../../src/lib/server/sync/vaultId');
};

let vault: string;
let m: Modules;

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

function event(pathAndQuery: string, init?: RequestInit): RequestEvent {
	const url = new URL(pathAndQuery, 'http://localhost:3000');
	return { url, request: new Request(url, init) } as unknown as RequestEvent;
}

const fileUrl = (rel: string) => `/api/sync/file?path=${encodeURIComponent(rel)}`;

/** Detached copy — `BodyInit` will not take a view over a pooled buffer. */
function toBody(bytes: Uint8Array): ArrayBuffer {
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	return copy;
}

async function get(rel: string) {
	return m.fileGET(event(fileUrl(rel)));
}

async function put(rel: string, body: Uint8Array | string, ifMatch?: string) {
	const headers = new Headers();
	if (ifMatch !== undefined) headers.set('If-Match', ifMatch);
	const payload: BodyInit = typeof body === 'string' ? body : toBody(body);
	return m.filePUT(event(fileUrl(rel), { method: 'PUT', body: payload, headers }));
}

async function del(rel: string, ifMatch?: string) {
	const headers = new Headers();
	if (ifMatch !== undefined) headers.set('If-Match', ifMatch);
	return m.fileDELETE(event(fileUrl(rel), { method: 'DELETE', headers }));
}

async function manifest() {
	const res = await m.manifestGET(event('/api/sync/manifest'));
	expect(res.status).toBe(200);
	return (await res.json()) as {
		cursor: string;
		generated_at: string;
		files: Array<{ path: string; sha256: string; size: number; mtime: number }>;
		tombstones: Array<{ path: string; deleted_at: number }>;
	};
}

const RESTAURANT_MD = [
	'---',
	'id: 11111111-2222-3333-4444-555555555555',
	'schema_version: 1',
	'name: Etta',
	'suburb: Brunswick East',
	'cuisine:',
	'  - Modern Australian',
	'lists:',
	'  - Brunch',
	'tags:',
	'  - wine',
	'---',
	'',
	'Great natural wine list.',
	''
].join('\n');

beforeAll(async () => {
	vault = mkdtempSync(path.join(os.tmpdir(), 'restauranteer-syncapi-'));
	process.env.VAULT_PATH = vault;
	process.env.VAULT_SUBDIR = 'Restaurants';
	process.env.LOG_LEVEL = 'error';

	mkdirSync(path.join(vault, 'Restaurants', '_Lists'), { recursive: true });
	mkdirSync(path.join(vault, 'Restaurants', '_attachments'), { recursive: true });
	mkdirSync(path.join(vault, 'Restaurants', '.restauranteer-tmp'), { recursive: true });
	mkdirSync(path.join(vault, 'Inbox'), { recursive: true });

	const [fileRoute, manifestRoute, infoRoute, queries, schema, tombstones, vaultIdMod] =
		await Promise.all([
			import('../../src/routes/api/sync/file/+server'),
			import('../../src/routes/api/sync/manifest/+server'),
			import('../../src/routes/api/sync/info/+server'),
			import('../../src/lib/server/db/queries'),
			import('../../src/lib/server/db/schema'),
			import('../../src/lib/server/sync/tombstones'),
			import('../../src/lib/server/sync/vaultId')
		]);

	m = {
		fileGET: fileRoute.GET as unknown as Handler,
		filePUT: fileRoute.PUT as unknown as Handler,
		fileDELETE: fileRoute.DELETE as unknown as Handler,
		manifestGET: manifestRoute.GET as unknown as Handler,
		infoGET: infoRoute.GET as unknown as Handler,
		queries,
		schema,
		tombstones,
		vaultId: vaultIdMod
	};
});

afterAll(() => {
	m?.schema.closeDb();
	rmSync(vault, { recursive: true, force: true });
});

beforeEach(() => {
	// Reset the vault content between cases so each one starts from a known
	// state; the DB is kept (migrations are expensive) but emptied.
	for (const dir of ['Restaurants', 'Inbox']) {
		rmSync(path.join(vault, dir), { recursive: true, force: true });
	}
	mkdirSync(path.join(vault, 'Restaurants', '_Lists'), { recursive: true });
	mkdirSync(path.join(vault, 'Restaurants', '_attachments'), { recursive: true });
	rmSync(path.join(vault, '.restauranteer-settings.json'), { force: true });
	mkdirSync(path.join(vault, 'Inbox'), { recursive: true });
	const db = m.schema.getDb();
	db.exec('DELETE FROM sync_tombstones');
	db.exec('DELETE FROM restaurants_fts');
	db.exec('DELETE FROM restaurants');
});

/* -------------------------------------------------------------------------- */

describe('GET /api/sync/info', () => {
	it('reports the frozen handshake shape and a stable vault_id', async () => {
		const res = await m.infoGET(event('/api/sync/info'));
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toMatchObject({
			app: 'restauranteer',
			schema_version: 1,
			protocol: 1,
			capabilities: ['manifest', 'file', 'delete']
		});
		expect(body.vault_id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		);

		const again = (await (await m.infoGET(event('/api/sync/info'))).json()) as {
			vault_id: string;
		};
		expect(again.vault_id).toBe(body.vault_id);
	});

	it('persists vault_id in info.md so it survives an index rebuild', async () => {
		const first = (await (await m.infoGET(event('/api/sync/info'))).json()) as {
			vault_id: string;
		};
		const info = readFileSync(path.join(vault, 'info.md'), 'utf8');
		expect(info).toContain(`vault_id: ${first.vault_id}`);

		// Blow away the cached copy — info.md must still be authoritative.
		m.schema.deleteMeta('vault_id');
		expect(await m.vaultId.ensureVaultId()).toBe(first.vault_id);
		expect(m.vaultId.cachedVaultId()).toBe(first.vault_id);
	});
});

/* -------------------------------------------------------------------------- */

describe('GET /api/sync/file', () => {
	it('serves raw bytes with ETag and X-Vault-Mtime', async () => {
		writeFileSync(path.join(vault, 'Restaurants', 'Etta.md'), RESTAURANT_MD);
		const res = await get('Restaurants/Etta.md');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
		expect(res.headers.get('ETag')).toBe(`"${sha256(RESTAURANT_MD)}"`);
		const mtime = Number(res.headers.get('X-Vault-Mtime'));
		expect(Number.isInteger(mtime)).toBe(true);
		expect(mtime).toBeGreaterThan(0);
		expect(await res.text()).toBe(RESTAURANT_MD);
	});

	it('404s a missing file with the frozen error body', async () => {
		const res = await get('Restaurants/Nope.md');
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'not_found' });
	});

	it('404s a directory rather than serving something odd', async () => {
		const res = await get('Restaurants/_Lists');
		expect(res.status).toBe(404);
	});

	it('400s a non-allowlisted path', async () => {
		for (const rel of ['../etc/passwd', '.restauranteer/index.db', 'Notes/x.md']) {
			const res = await get(rel);
			expect(res.status, rel).toBe(400);
			expect(((await res.json()) as { error: string }).error).toBe('invalid_path');
		}
	});

	it('400s when path is missing entirely', async () => {
		const res = await m.fileGET(event('/api/sync/file'));
		expect(res.status).toBe(400);
	});
});

/* -------------------------------------------------------------------------- */

describe('PUT /api/sync/file', () => {
	it('creates a file when no If-Match is sent', async () => {
		const res = await put('Restaurants/Etta.md', RESTAURANT_MD);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			sha256: sha256(RESTAURANT_MD),
			mtime: expect.any(Number)
		});
		expect(readFileSync(path.join(vault, 'Restaurants', 'Etta.md'), 'utf8')).toBe(RESTAURANT_MD);
	});

	it('creates missing intermediate directories', async () => {
		const res = await put('Restaurants/_attachments/etta/2026-01-01.md', '# photo notes\n');
		expect(res.status).toBe(200);
		expect(existsSync(path.join(vault, 'Restaurants', '_attachments', 'etta'))).toBe(true);
	});

	it('409s create-only against an existing file, reporting the server sha', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		const res = await put('Restaurants/Etta.md', 'different content\n');
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: 'conflict',
			server_sha256: sha256(RESTAURANT_MD)
		});
		// The losing write must not have landed.
		expect(readFileSync(path.join(vault, 'Restaurants', 'Etta.md'), 'utf8')).toBe(RESTAURANT_MD);
	});

	it('updates when If-Match matches the current sha', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		const updated = `${RESTAURANT_MD}\nSecond visit was even better.\n`;
		const res = await put('Restaurants/Etta.md', updated, `"${sha256(RESTAURANT_MD)}"`);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { sha256: string }).sha256).toBe(sha256(updated));
		expect(readFileSync(path.join(vault, 'Restaurants', 'Etta.md'), 'utf8')).toBe(updated);
	});

	it('accepts unquoted and weak ETags', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		const bare = await put('Restaurants/Etta.md', 'v2\n', sha256(RESTAURANT_MD));
		expect(bare.status).toBe(200);
		const weak = await put('Restaurants/Etta.md', 'v3\n', `W/"${sha256('v2\n')}"`);
		expect(weak.status).toBe(200);
	});

	it('409s on an If-Match mismatch and reports the server sha', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		const res = await put('Restaurants/Etta.md', 'mine\n', `"${sha256('stale content')}"`);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: 'conflict',
			server_sha256: sha256(RESTAURANT_MD)
		});
	});

	it('409s with a null server sha when the client expects a file the server no longer has', async () => {
		const res = await put('Restaurants/Gone.md', 'mine\n', `"${sha256('whatever')}"`);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'conflict', server_sha256: null });
	});

	it('overwrites unconditionally with If-Match: *', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		const res = await put('Restaurants/Etta.md', 'forced\n', '*');
		expect(res.status).toBe(200);
		expect(readFileSync(path.join(vault, 'Restaurants', 'Etta.md'), 'utf8')).toBe('forced\n');
	});

	it('400s a non-allowlisted path without writing anything', async () => {
		// The real index database lives here — a successful write would corrupt it.
		const dbFile = path.join(vault, '.restauranteer', 'index.db');
		const res = await put('.restauranteer/index.db', 'pwned');
		expect(res.status).toBe(400);
		expect(readFileSync(dbFile).subarray(0, 15).toString('utf8')).toBe('SQLite format 3');

		const escape = await put('../escaped.md', 'pwned');
		expect(escape.status).toBe(400);
		expect(existsSync(path.join(path.dirname(vault), 'escaped.md'))).toBe(false);
	});

	it('round-trips a binary attachment byte-for-byte', async () => {
		// A tiny but genuinely non-UTF-8 payload (JPEG SOI + high bytes).
		const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x80, 0xfe, 0x00]);
		const rel = 'Restaurants/_attachments/etta/2026-01-01-120000.jpg';
		const written = await put(rel, bytes);
		expect(written.status).toBe(200);
		expect(((await written.json()) as { sha256: string }).sha256).toBe(sha256(bytes));

		const res = await get(rel);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/jpeg');
		const back = new Uint8Array(await res.arrayBuffer());
		expect(Array.from(back)).toEqual(Array.from(bytes));
		expect(res.headers.get('ETag')).toBe(`"${sha256(bytes)}"`);
	});

	it('accepts the root settings dotfile and info.md', async () => {
		expect((await put('.restauranteer-settings.json', '{"theme_mode":"dark"}')).status).toBe(200);
		expect((await get('.restauranteer-settings.json')).status).toBe(200);
		expect((await put('info.md', '# info\n', '*')).status).toBe(200);
	});

	it('accepts Inbox files', async () => {
		expect((await put('Inbox/2026-07-26-link.md', '# a shared link\n')).status).toBe(200);
		expect(await (await get('Inbox/2026-07-26-link.md')).text()).toBe('# a shared link\n');
	});
});

/* -------------------------------------------------------------------------- */

describe('PUT lands in the SQLite index', () => {
	it('indexes a pushed restaurant immediately, without waiting for the watcher', async () => {
		expect(m.queries.getRestaurantByUuid('11111111-2222-3333-4444-555555555555')).toBeNull();

		const res = await put('Restaurants/Etta.md', RESTAURANT_MD);
		expect(res.status).toBe(200);

		const row = m.queries.getRestaurantByUuid('11111111-2222-3333-4444-555555555555');
		expect(row).not.toBeNull();
		expect(row!.name).toBe('Etta');
		expect(row!.file_path).toBe(path.join(vault, 'Restaurants', 'Etta.md'));
		expect(row!.sha256).toBe(sha256(RESTAURANT_MD));
		expect(row!.lists).toEqual(['Brunch']);
		expect(row!.tags).toEqual(['wine']);
	});

	it('reflects an update through the index too', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		const renamed = RESTAURANT_MD.replace('name: Etta', 'name: Etta Dining');
		const res = await put('Restaurants/Etta.md', renamed, `"${sha256(RESTAURANT_MD)}"`);
		expect(res.status).toBe(200);
		expect(m.queries.getRestaurantByUuid('11111111-2222-3333-4444-555555555555')!.name).toBe(
			'Etta Dining'
		);
	});

	it('does not try to index attachments or Inbox files', async () => {
		expect((await put('Restaurants/_attachments/x.jpg', new Uint8Array([1, 2, 3]))).status).toBe(
			200
		);
		expect((await put('Inbox/note.md', '# no frontmatter\n')).status).toBe(200);
		expect(m.queries.getAllRestaurants()).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */

describe('DELETE /api/sync/file', () => {
	it('deletes with a matching If-Match, drops the index row and records a tombstone', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		expect(m.queries.getRestaurantByUuid('11111111-2222-3333-4444-555555555555')).not.toBeNull();

		const res = await del('Restaurants/Etta.md', `"${sha256(RESTAURANT_MD)}"`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ deleted: true });
		expect(existsSync(path.join(vault, 'Restaurants', 'Etta.md'))).toBe(false);
		expect(m.queries.getRestaurantByUuid('11111111-2222-3333-4444-555555555555')).toBeNull();

		const tombstone = m.tombstones.getTombstone('Restaurants/Etta.md');
		expect(tombstone).not.toBeNull();
		expect(tombstone!.last_sha).toBe(sha256(RESTAURANT_MD));
		expect(tombstone!.deleted_at).toBeGreaterThan(0);
	});

	it('accepts If-Match: *', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		expect((await del('Restaurants/Etta.md', '*')).status).toBe(200);
	});

	it('409s an If-Match mismatch and leaves the file alone', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		const res = await del('Restaurants/Etta.md', `"${sha256('stale')}"`);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: 'conflict',
			server_sha256: sha256(RESTAURANT_MD)
		});
		expect(existsSync(path.join(vault, 'Restaurants', 'Etta.md'))).toBe(true);
		expect(m.tombstones.getTombstone('Restaurants/Etta.md')).toBeNull();
	});

	it('404s a file that is already gone', async () => {
		const res = await del('Restaurants/Nope.md', '*');
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'not_found' });
	});

	it('400s when If-Match is omitted', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		const res = await del('Restaurants/Etta.md');
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe('if_match_required');
		expect(existsSync(path.join(vault, 'Restaurants', 'Etta.md'))).toBe(true);
	});

	it('400s a non-allowlisted path', async () => {
		expect((await del('../etc/passwd', '*')).status).toBe(400);
	});
});

/* -------------------------------------------------------------------------- */

describe('GET /api/sync/manifest', () => {
	it('lists every allowlisted file with a correct sha, size and mtime', async () => {
		writeFileSync(path.join(vault, 'Restaurants', 'Etta.md'), RESTAURANT_MD);
		writeFileSync(path.join(vault, 'Restaurants', '_Lists', 'Brunch.md'), '# Brunch\n');
		mkdirSync(path.join(vault, 'Restaurants', '_attachments', 'etta'), { recursive: true });
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x84]);
		writeFileSync(path.join(vault, 'Restaurants', '_attachments', 'etta', 'a.jpg'), jpeg);
		writeFileSync(path.join(vault, 'Inbox', 'link.md'), '# link\n');
		writeFileSync(path.join(vault, '.restauranteer-settings.json'), '{}');

		const body = await manifest();
		const byPath = new Map(body.files.map((f) => [f.path, f]));

		expect([...byPath.keys()]).toEqual(expect.arrayContaining([
			'Restaurants/Etta.md',
			'Restaurants/_Lists/Brunch.md',
			'Restaurants/_attachments/etta/a.jpg',
			'Inbox/link.md',
			'.restauranteer-settings.json'
		]));

		expect(byPath.get('Restaurants/Etta.md')).toMatchObject({
			sha256: sha256(RESTAURANT_MD),
			size: Buffer.byteLength(RESTAURANT_MD)
		});
		// Attachments are hashed as bytes, not as decoded text.
		expect(byPath.get('Restaurants/_attachments/etta/a.jpg')).toMatchObject({
			sha256: sha256(jpeg),
			size: jpeg.byteLength
		});
		expect(Number.isInteger(byPath.get('Restaurants/Etta.md')!.mtime)).toBe(true);

		expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(body.cursor).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is sorted by path and excludes dot-prefixed noise', async () => {
		writeFileSync(path.join(vault, 'Restaurants', 'Zzz.md'), 'z\n');
		writeFileSync(path.join(vault, 'Restaurants', 'Aaa.md'), 'a\n');
		writeFileSync(path.join(vault, 'Restaurants', '.DS_Store'), 'junk');
		writeFileSync(path.join(vault, 'Restaurants', '.Etta.md.icloud'), 'placeholder stub');
		mkdirSync(path.join(vault, 'Restaurants', '.restauranteer-tmp'), { recursive: true });
		writeFileSync(path.join(vault, 'Restaurants', '.restauranteer-tmp', 'x.tmp-1'), 'partial');

		const body = await manifest();
		const paths = body.files.map((f) => f.path);
		expect(paths).toEqual([...paths].sort());
		expect(paths).toContain('Restaurants/Aaa.md');
		expect(paths).toContain('Restaurants/Zzz.md');
		expect(paths.some((p) => p.includes('.DS_Store'))).toBe(false);
		expect(paths.some((p) => p.includes('.icloud'))).toBe(false);
		expect(paths.some((p) => p.includes('.restauranteer-tmp'))).toBe(false);
	});

	it('changes the cursor when content changes and holds it steady when it does not', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		const first = await manifest();
		const unchanged = await manifest();
		expect(unchanged.cursor).toBe(first.cursor);

		await put('Restaurants/Etta.md', 'changed\n', '*');
		const changed = await manifest();
		expect(changed.cursor).not.toBe(first.cursor);
	});

	it('surfaces a deleted file as a tombstone, not as an absence', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		expect((await manifest()).files.map((f) => f.path)).toContain('Restaurants/Etta.md');

		await del('Restaurants/Etta.md', '*');

		const after = await manifest();
		expect(after.files.map((f) => f.path)).not.toContain('Restaurants/Etta.md');
		expect(after.tombstones).toEqual([
			{ path: 'Restaurants/Etta.md', deleted_at: expect.any(Number) }
		]);
	});

	it('clears the tombstone when the path is re-created', async () => {
		await put('Restaurants/Etta.md', RESTAURANT_MD);
		await del('Restaurants/Etta.md', '*');
		expect((await manifest()).tombstones.map((t) => t.path)).toEqual(['Restaurants/Etta.md']);

		const recreated = await put('Restaurants/Etta.md', RESTAURANT_MD);
		expect(recreated.status).toBe(200);

		const after = await manifest();
		expect(after.tombstones).toEqual([]);
		expect(after.files.map((f) => f.path)).toContain('Restaurants/Etta.md');
		expect(m.tombstones.getTombstone('Restaurants/Etta.md')).toBeNull();
	});

	it('never reports a path as both present and deleted', async () => {
		// A stale tombstone (file restored outside the API) must lose to reality.
		m.tombstones.recordTombstone('Restaurants/Etta.md', sha256(RESTAURANT_MD));
		writeFileSync(path.join(vault, 'Restaurants', 'Etta.md'), RESTAURANT_MD);

		const body = await manifest();
		expect(body.files.map((f) => f.path)).toContain('Restaurants/Etta.md');
		expect(body.tombstones).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */

describe('tombstone lifecycle', () => {
	it('prunes entries past the TTL and keeps fresh ones', async () => {
		await put('Restaurants/Old.md', 'old\n');
		await put('Restaurants/New.md', 'new\n');
		await del('Restaurants/Old.md', '*');
		await del('Restaurants/New.md', '*');

		m.schema
			.getDb()
			.prepare('UPDATE sync_tombstones SET deleted_at = ? WHERE path = ?')
			.run(Date.now() - 91 * 24 * 60 * 60 * 1000, 'Restaurants/Old.md');

		expect(m.tombstones.pruneTombstones()).toBe(1);
		expect(m.tombstones.listTombstones().map((t) => t.path)).toEqual(['Restaurants/New.md']);
	});

	it('ignores deletions of paths that never appear in a manifest', () => {
		m.tombstones.recordVaultDeletion(path.join(vault, '.restauranteer', 'index.db'));
		m.tombstones.recordVaultDeletion(
			path.join(vault, 'Restaurants', '.restauranteer-tmp', 'Etta.md.tmp-1')
		);
		m.tombstones.recordVaultDeletion('/etc/passwd');
		expect(m.tombstones.listTombstones()).toEqual([]);
	});

	it('records a vault-internal deletion by absolute path', () => {
		m.tombstones.recordVaultDeletion(path.join(vault, 'Restaurants', 'Renamed-Away.md'), 'abc');
		expect(m.tombstones.getTombstone('Restaurants/Renamed-Away.md')).toMatchObject({
			path: 'Restaurants/Renamed-Away.md',
			last_sha: 'abc'
		});
	});
});

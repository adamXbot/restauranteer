/**
 * The vault's *own* delete paths must record tombstones too — not just the
 * sync DELETE endpoint. Otherwise a rename, an emptied list MOC or a file that
 * vanished from disk would look to a client like "new locally, missing on the
 * server", and it would helpfully upload the file straight back.
 *
 * Covered here: rename's old-file removal, the MOC sweep, `fullReconcile`'s
 * orphan detection, and the write-clears-tombstone rule in `writer.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type Modules = {
	rename: typeof import('../../src/lib/server/vault/rename');
	reconciler: typeof import('../../src/lib/server/vault/reconciler');
	moc: typeof import('../../src/lib/server/vault/moc');
	writer: typeof import('../../src/lib/server/vault/writer');
	queries: typeof import('../../src/lib/server/db/queries');
	schema: typeof import('../../src/lib/server/db/schema');
	tombstones: typeof import('../../src/lib/server/sync/tombstones');
};

let vault: string;
let m: Modules;

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function restaurantMarkdown(name: string, lists: string[] = []): string {
	return [
		'---',
		`id: ${UUID}`,
		'schema_version: 1',
		`name: ${name}`,
		...(lists.length > 0 ? ['lists:', ...lists.map((l) => `  - ${l}`)] : []),
		'---',
		'',
		'Notes.',
		''
	].join('\n');
}

beforeAll(async () => {
	vault = mkdtempSync(path.join(os.tmpdir(), 'restauranteer-tombstone-'));
	process.env.VAULT_PATH = vault;
	process.env.VAULT_SUBDIR = 'Restaurants';
	process.env.LOG_LEVEL = 'error';
	mkdirSync(path.join(vault, 'Restaurants', '_Lists'), { recursive: true });

	const [rename, reconciler, moc, writer, queries, schema, tombstones] = await Promise.all([
		import('../../src/lib/server/vault/rename'),
		import('../../src/lib/server/vault/reconciler'),
		import('../../src/lib/server/vault/moc'),
		import('../../src/lib/server/vault/writer'),
		import('../../src/lib/server/db/queries'),
		import('../../src/lib/server/db/schema'),
		import('../../src/lib/server/sync/tombstones')
	]);
	m = { rename, reconciler, moc, writer, queries, schema, tombstones };
});

afterAll(() => {
	m?.schema.closeDb();
	rmSync(vault, { recursive: true, force: true });
});

beforeEach(() => {
	rmSync(path.join(vault, 'Restaurants'), { recursive: true, force: true });
	mkdirSync(path.join(vault, 'Restaurants', '_Lists'), { recursive: true });
	const db = m.schema.getDb();
	db.exec('DELETE FROM sync_tombstones');
	db.exec('DELETE FROM restaurants_fts');
	db.exec('DELETE FROM lists');
	db.exec('DELETE FROM tags');
	db.exec('DELETE FROM restaurants');
});

describe('rename', () => {
	it('tombstones the old file so clients delete it instead of re-uploading', async () => {
		const oldPath = path.join(vault, 'Restaurants', 'Etta.md');
		writeFileSync(oldPath, restaurantMarkdown('Etta'));
		await m.reconciler.indexSingleFile(oldPath);

		const result = await m.rename.renameRestaurant(UUID, 'Etta Dining');
		expect(result.renamed).toBe(true);

		expect(m.tombstones.getTombstone('Restaurants/Etta.md')).not.toBeNull();
		// The new file must NOT be tombstoned — writer.ts clears on write.
		expect(m.tombstones.getTombstone('Restaurants/Etta Dining.md')).toBeNull();
		expect(m.tombstones.listTombstones().map((t) => t.path)).toEqual(['Restaurants/Etta.md']);
	});

	it('records nothing when the file path does not actually change', async () => {
		const filePath = path.join(vault, 'Restaurants', 'Etta.md');
		writeFileSync(filePath, restaurantMarkdown('Etta'));
		await m.reconciler.indexSingleFile(filePath);

		// A pure case change resolves to the same path on this filesystem.
		await m.rename.renameRestaurant(UUID, 'Etta');
		expect(m.tombstones.listTombstones()).toEqual([]);
	});
});

describe('fullReconcile orphan sweep', () => {
	it('tombstones index rows whose file has vanished from disk', async () => {
		const filePath = path.join(vault, 'Restaurants', 'Etta.md');
		writeFileSync(filePath, restaurantMarkdown('Etta'));
		await m.reconciler.indexSingleFile(filePath);
		expect(m.queries.getRestaurantByUuid(UUID)).not.toBeNull();

		rmSync(filePath);
		const result = await m.reconciler.fullReconcile();

		expect(result.removed).toBe(1);
		expect(m.queries.getRestaurantByUuid(UUID)).toBeNull();
		const tombstone = m.tombstones.getTombstone('Restaurants/Etta.md');
		expect(tombstone).not.toBeNull();
		// The sweep knows the last indexed sha, so clients can tell which
		// version was deleted.
		expect(tombstone!.last_sha).toBeTruthy();
	});

	it('leaves files that are still present alone', async () => {
		const filePath = path.join(vault, 'Restaurants', 'Etta.md');
		writeFileSync(filePath, restaurantMarkdown('Etta'));
		await m.reconciler.fullReconcile();
		expect(m.tombstones.listTombstones()).toEqual([]);
	});
});

describe('MOC sweep', () => {
	it('tombstones a list MOC removed because the list is now empty', async () => {
		const filePath = path.join(vault, 'Restaurants', 'Etta.md');
		writeFileSync(filePath, restaurantMarkdown('Etta', ['Brunch']));
		await m.reconciler.indexSingleFile(filePath);
		await m.moc.writeMocForList('Brunch');
		expect(m.tombstones.getTombstone('Restaurants/_Lists/Brunch.md')).toBeNull();

		// Drop the restaurant, so the list has no members left.
		rmSync(filePath);
		m.queries.deleteRestaurantByPath(filePath);
		await m.moc.writeMocForList('Brunch');

		expect(m.tombstones.getTombstone('Restaurants/_Lists/Brunch.md')).not.toBeNull();
	});

	it('tombstones stale MOCs dropped by regenerateAllMocs', async () => {
		writeFileSync(path.join(vault, 'Restaurants', '_Lists', 'Ghost.md'), [
			'---',
			'generated_by: restauranteer',
			'do_not_edit: true',
			'schema_version: 1',
			'list_name: Ghost',
			'---',
			'',
			'# Ghost',
			''
		].join('\n'));

		await m.moc.regenerateAllMocs();
		expect(m.tombstones.getTombstone('Restaurants/_Lists/Ghost.md')).not.toBeNull();
	});
});

describe('writer clears tombstones', () => {
	it('re-creating a tombstoned path clears its tombstone', async () => {
		const filePath = path.join(vault, 'Restaurants', 'Etta.md');
		m.tombstones.recordVaultDeletion(filePath, 'deadbeef');
		expect(m.tombstones.getTombstone('Restaurants/Etta.md')).not.toBeNull();

		await m.writer.atomicWriteText(filePath, restaurantMarkdown('Etta'));
		expect(m.tombstones.getTombstone('Restaurants/Etta.md')).toBeNull();
	});

	it('clears on a binary write too', async () => {
		const filePath = path.join(vault, 'Restaurants', '_attachments', 'a.jpg');
		m.tombstones.recordVaultDeletion(filePath, 'deadbeef');
		expect(m.tombstones.getTombstone('Restaurants/_attachments/a.jpg')).not.toBeNull();

		await m.writer.atomicWriteBytes(filePath, new Uint8Array([0xff, 0xd8, 0xff]));
		expect(m.tombstones.getTombstone('Restaurants/_attachments/a.jpg')).toBeNull();
	});

	it('hashes bytes, so the sha matches what a sync client computes', async () => {
		const filePath = path.join(vault, 'Restaurants', '_attachments', 'b.jpg');
		const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x80, 0xfe]);
		const { sha } = await m.writer.atomicWriteBytes(filePath, bytes);
		const { createHash } = await import('node:crypto');
		expect(sha).toBe(createHash('sha256').update(bytes).digest('hex'));
	});

	it('registers the write as a self-write so the watcher suppresses its echo', async () => {
		const filePath = path.join(vault, 'Restaurants', 'Selfwrite.md');
		const content = restaurantMarkdown('Selfwrite');
		const { sha } = await m.writer.atomicWriteBytes(filePath, new TextEncoder().encode(content));
		// The watcher hashes the decoded text; for UTF-8 that equals the byte hash.
		expect(m.writer.isSelfWrite(filePath, sha)).toBe(true);
		// Consumed exactly once.
		expect(m.writer.isSelfWrite(filePath, sha)).toBe(false);
	});
});

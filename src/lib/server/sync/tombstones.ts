/**
 * Deletion tombstones.
 *
 * The sync manifest lists what exists. Without tombstones a client cannot tell
 * "this file was deleted on the server" from "this file is new on my device" —
 * both look like *present locally, absent on the server*. So every deletion of
 * an allowlisted vault file records a row here, and the manifest serves them
 * alongside the file list.
 *
 * Write sites (all funnel through `recordVaultDeletion`):
 *   - `DELETE /api/sync/file`                       (this API)
 *   - `vault/rename.ts`                             (old file after a rename)
 *   - `vault/moc.ts`                                (empty / stale list MOCs)
 *   - `api/restaurants/[uuid]/visits/[index]`       (visit photo + thumbnail)
 *   - `vault/watcher.ts`                            (external deletes, e.g. Obsidian)
 *   - `vault/reconciler.ts`                         (orphan sweep on full reconcile)
 *
 * Re-creating a path clears its tombstone — that happens automatically because
 * `vault/writer.ts` calls `clearTombstone()` on every atomic write.
 *
 * All functions are defensive: a tombstone failure must never break a vault
 * write or delete, so errors are logged and swallowed.
 */
import { getDb } from '../db/schema';
import { toSyncRelPath } from './paths';
import { log } from '../log';

export type Tombstone = {
	path: string;
	deleted_at: number;
	last_sha: string | null;
};

export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Record a deletion by wire-format relative path. */
export function recordTombstone(relPath: string, lastSha: string | null = null): void {
	try {
		getDb()
			.prepare(
				`INSERT INTO sync_tombstones (path, deleted_at, last_sha) VALUES (?, ?, ?)
				 ON CONFLICT(path) DO UPDATE SET deleted_at = excluded.deleted_at,
				                                 last_sha = COALESCE(excluded.last_sha, sync_tombstones.last_sha)`
			)
			.run(relPath, Date.now(), lastSha);
	} catch (err) {
		log.warn('Failed to record tombstone', { path: relPath, error: String(err) });
	}
}

/**
 * Record a deletion by absolute filesystem path. Silently ignores paths that
 * are outside the vault or not sync-allowlisted (temp files, the index DB,
 * dotfiles) — those never appear in a manifest, so a tombstone would be noise.
 */
export function recordVaultDeletion(absPath: string, lastSha: string | null = null): void {
	let rel: string | null;
	try {
		rel = toSyncRelPath(absPath);
	} catch (err) {
		log.warn('Failed to map deleted path for tombstone', { absPath, error: String(err) });
		return;
	}
	if (!rel) return;
	recordTombstone(rel, lastSha);
}

/** Drop the tombstone for a path — called whenever the path is written again. */
export function clearTombstone(relPath: string): void {
	try {
		getDb().prepare('DELETE FROM sync_tombstones WHERE path = ?').run(relPath);
	} catch (err) {
		log.debug('Failed to clear tombstone', { path: relPath, error: String(err) });
	}
}

/** Clear by absolute path; the inverse of `recordVaultDeletion`. */
export function clearVaultTombstone(absPath: string): void {
	let rel: string | null;
	try {
		rel = toSyncRelPath(absPath);
	} catch {
		return;
	}
	if (!rel) return;
	clearTombstone(rel);
}

export function listTombstones(): Tombstone[] {
	try {
		return getDb()
			.prepare('SELECT path, deleted_at, last_sha FROM sync_tombstones ORDER BY path')
			.all() as Tombstone[];
	} catch (err) {
		log.warn('Failed to list tombstones', { error: String(err) });
		return [];
	}
}

export function getTombstone(relPath: string): Tombstone | null {
	try {
		const row = getDb()
			.prepare('SELECT path, deleted_at, last_sha FROM sync_tombstones WHERE path = ?')
			.get(relPath) as Tombstone | undefined;
		return row ?? null;
	} catch {
		return null;
	}
}

/** Remove tombstones older than the TTL. Called once on boot. */
export function pruneTombstones(ttlMs: number = TOMBSTONE_TTL_MS): number {
	try {
		const cutoff = Date.now() - ttlMs;
		const result = getDb().prepare('DELETE FROM sync_tombstones WHERE deleted_at < ?').run(cutoff);
		return result.changes;
	} catch (err) {
		log.warn('Failed to prune tombstones', { error: String(err) });
		return 0;
	}
}

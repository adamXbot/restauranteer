/**
 * The sync manifest — a full listing of every allowlisted vault file with its
 * content hash, plus the tombstones for everything that was deleted.
 *
 * v1 always returns the whole thing (500 restaurants ≈ 60 KB of JSON). The
 * `cursor` is opaque: a hash over the sorted (path, sha) pairs and tombstones,
 * so a client can cheaply tell "nothing moved" without diffing. Clients may
 * ignore it entirely in v1; `?since=` is reserved for a real server-side change
 * log later.
 *
 * Hashes are over **raw bytes**, never a decoded string — attachments are
 * binary, and a JPEG must hash identically on both sides.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { allowlistedDirs, allowlistedFiles, toAbsPath } from './paths';
import { listTombstones, type Tombstone } from './tombstones';
import { log } from '../log';

export type ManifestFile = {
	path: string;
	sha256: string;
	size: number;
	mtime: number;
};

export type ManifestTombstone = {
	path: string;
	deleted_at: number;
};

export type Manifest = {
	cursor: string;
	generated_at: string;
	files: ManifestFile[];
	tombstones: ManifestTombstone[];
};

export function sha256Bytes(data: Uint8Array): string {
	return createHash('sha256').update(data).digest('hex');
}

/** Epoch milliseconds, integral — the wire format has no room for fractions. */
export function toEpochMs(mtimeMs: number): number {
	return Math.round(mtimeMs);
}

/**
 * Walk the allowlisted tree and hash every file. Attachments are included:
 * photos are part of the vault and the client fetches them through the same
 * endpoint.
 */
export async function buildManifest(): Promise<Manifest> {
	const files: ManifestFile[] = [];

	for (const dir of allowlistedDirs()) {
		await walk(toAbsPath(dir), dir, files);
	}
	for (const rel of allowlistedFiles()) {
		const entry = await describeFile(toAbsPath(rel), rel);
		if (entry) files.push(entry);
	}

	files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

	// A tombstone for a path that exists again is stale (the file was
	// re-created outside a code path that clears it). Present beats deleted.
	const present = new Set(files.map((f) => f.path));
	const tombstones: ManifestTombstone[] = listTombstones()
		.filter((t: Tombstone) => !present.has(t.path))
		.map((t) => ({ path: t.path, deleted_at: t.deleted_at }));

	return {
		cursor: computeCursor(files, tombstones),
		generated_at: new Date().toISOString(),
		files,
		tombstones
	};
}

/** Opaque cursor: sha256 over the sorted manifest content. */
export function computeCursor(files: ManifestFile[], tombstones: ManifestTombstone[]): string {
	const hash = createHash('sha256');
	for (const f of files) hash.update(`${f.path}\0${f.sha256}\0${f.size}\n`);
	for (const t of tombstones) hash.update(`-${t.path}\0${t.deleted_at}\n`);
	return hash.digest('hex');
}

async function walk(absDir: string, relDir: string, out: ManifestFile[]): Promise<void> {
	let entries;
	try {
		entries = await readdir(absDir, { withFileTypes: true });
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') return;
		log.warn('Manifest walk failed', { dir: absDir, error: String(err) });
		return;
	}

	for (const entry of entries) {
		// Skips `.restauranteer-tmp/`, `.DS_Store`, iCloud `.foo.md.icloud`
		// placeholder stubs, and anything else dot-prefixed — the same rule the
		// path allowlist enforces on writes.
		if (entry.name.startsWith('.')) continue;
		const abs = path.join(absDir, entry.name);
		const rel = `${relDir}/${entry.name}`;
		if (entry.isDirectory()) {
			await walk(abs, rel, out);
		} else if (entry.isFile()) {
			const described = await describeFile(abs, rel);
			if (described) out.push(described);
		}
		// Symlinks are deliberately skipped: entry.isFile() is false for them,
		// and following one could hash something outside the vault.
	}
}

async function describeFile(abs: string, rel: string): Promise<ManifestFile | null> {
	try {
		const stats = await stat(abs);
		if (!stats.isFile()) return null;
		const bytes = await readFile(abs);
		return {
			path: rel,
			sha256: sha256Bytes(bytes),
			size: stats.size,
			mtime: toEpochMs(stats.mtimeMs)
		};
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') return null;
		log.warn('Could not hash vault file for manifest', { path: rel, error: String(err) });
		return null;
	}
}

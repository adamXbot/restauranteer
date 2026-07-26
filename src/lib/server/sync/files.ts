/**
 * Read / write / delete for a single vault file, plus the `If-Match`
 * concurrency rules the sync protocol is built on.
 *
 * `If-Match` is the whole concurrency story: the client sends the sha it
 * believes the server holds. A 409 means the server moved on, and the client
 * three-way-merges locally (base = last synced, ours = local, theirs = fetched)
 * and re-PUTs.
 */
import { readFile, stat, unlink } from 'node:fs/promises';
import { sha256Bytes, toEpochMs } from './manifest';
import { restaurantsRoot } from './paths';
import { atomicWriteBytes } from '../vault/writer';
import { indexSingleFile, removeSingleFile } from '../vault/reconciler';
import { log } from '../log';

export type FileState = {
	sha256: string;
	size: number;
	mtime: number;
};

export type ReadFileResult = FileState & { bytes: Buffer };

/**
 * Current state of a vault file, or null when it does not exist. The content
 * hash requires reading the bytes; vault files are small and this keeps the
 * hash authoritative rather than trusting mtime.
 */
export async function statSyncFile(abs: string): Promise<FileState | null> {
	const read = await readSyncFile(abs);
	if (!read) return null;
	return { sha256: read.sha256, size: read.size, mtime: read.mtime };
}

export async function readSyncFile(abs: string): Promise<ReadFileResult | null> {
	let stats;
	try {
		stats = await stat(abs);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') return null;
		throw err;
	}
	if (!stats.isFile()) return null;
	const bytes = await readFile(abs);
	return {
		bytes,
		sha256: sha256Bytes(bytes),
		size: stats.size,
		mtime: toEpochMs(stats.mtimeMs)
	};
}

/* -------------------------------------------------------------------------- */
/* If-Match                                                                   */
/* -------------------------------------------------------------------------- */

export type IfMatch =
	| { kind: 'absent' }
	| { kind: 'any' }
	| { kind: 'shas'; shas: string[] };

/**
 * Parse an `If-Match` header. Accepts strong (`"abc"`), weak (`W/"abc"`) and
 * bare (`abc`) entity tags, a comma-separated list of them, or `*`.
 *
 * Semantics on this API:
 *   - absent → create-only (a PUT to an existing path is a 409)
 *   - `*`    → unconditional overwrite (and create if absent)
 *   - sha(s) → the server's current content hash must be one of them
 */
export function parseIfMatch(header: string | null): IfMatch {
	if (header == null) return { kind: 'absent' };
	const trimmed = header.trim();
	if (trimmed.length === 0) return { kind: 'absent' };
	const parts = trimmed
		.split(',')
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (parts.some((p) => p === '*')) return { kind: 'any' };
	const shas = parts.map(stripEtagQuotes).filter((p) => p.length > 0);
	if (shas.length === 0) return { kind: 'absent' };
	return { kind: 'shas', shas };
}

function stripEtagQuotes(value: string): string {
	let out = value.trim();
	if (/^W\//i.test(out)) out = out.slice(2).trim();
	if (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) out = out.slice(1, -1);
	return out.trim().toLowerCase();
}

export type PreconditionResult =
	| { ok: true }
	| { ok: false; status: 409 | 404; serverSha: string | null };

/**
 * Evaluate an `If-Match` precondition for a write against the current state.
 * `current` is null when the file does not exist.
 */
export function checkWritePrecondition(
	ifMatch: IfMatch,
	current: FileState | null
): PreconditionResult {
	if (ifMatch.kind === 'absent') {
		// Create-only. The file already existing *is* the conflict.
		if (current) return { ok: false, status: 409, serverSha: current.sha256 };
		return { ok: true };
	}
	if (ifMatch.kind === 'any') return { ok: true };
	if (!current) {
		// The client believes the server holds a specific version, but the path
		// is gone. A conflict, not a 404 — the client should consult tombstones.
		return { ok: false, status: 409, serverSha: null };
	}
	if (ifMatch.shas.includes(current.sha256)) return { ok: true };
	return { ok: false, status: 409, serverSha: current.sha256 };
}

/** Evaluate an `If-Match` precondition for a delete. */
export function checkDeletePrecondition(
	ifMatch: IfMatch,
	current: FileState | null
): PreconditionResult {
	if (!current) return { ok: false, status: 404, serverSha: null };
	if (ifMatch.kind === 'any') return { ok: true };
	if (ifMatch.kind === 'absent') return { ok: false, status: 409, serverSha: current.sha256 };
	if (ifMatch.shas.includes(current.sha256)) return { ok: true };
	return { ok: false, status: 409, serverSha: current.sha256 };
}

/* -------------------------------------------------------------------------- */
/* Index maintenance                                                          */
/* -------------------------------------------------------------------------- */

/**
 * True for paths the SQLite index cares about: markdown directly under the
 * restaurants tree. Attachments, `Inbox/` and the root files are vault content
 * but carry no index row.
 */
export function isIndexedPath(rel: string): boolean {
	if (!rel.toLowerCase().endsWith('.md')) return false;
	const root = restaurantsRoot();
	return rel === root || rel.startsWith(`${root}/`);
}

/**
 * Write bytes and bring the index up to date in the same request.
 *
 * The watcher cannot be relied on here: under Docker-on-macOS host filesystem
 * events are not forwarded into the container, and even when they are, the
 * write we just made is registered as a self-write and deliberately suppressed.
 * So we index inline — a sync client that PUTs a file and immediately queries
 * the API must see it.
 */
export async function writeSyncFile(
	abs: string,
	rel: string,
	bytes: Uint8Array
): Promise<FileState> {
	const { sha, mtime } = await atomicWriteBytes(abs, bytes);
	if (isIndexedPath(rel)) {
		try {
			await indexSingleFile(abs);
		} catch (err) {
			log.warn('Sync write indexed poorly', { path: rel, error: String(err) });
		}
	}
	return { sha256: sha, size: bytes.byteLength, mtime: toEpochMs(mtime) };
}

/** Delete a file and drop its index row. */
export async function deleteSyncFile(abs: string, rel: string): Promise<void> {
	await unlink(abs);
	if (isIndexedPath(rel)) {
		try {
			removeSingleFile(abs);
		} catch (err) {
			log.warn('Sync delete failed to update index', { path: rel, error: String(err) });
		}
	}
}

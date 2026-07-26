/**
 * Path allowlist for the sync API.
 *
 * Every sync request names a file by a *vault-root-relative, POSIX-separated*
 * path (`Restaurants/Etta.md`). Two layers of defence:
 *
 *  1. `validateSyncPath()` — pure string validation. Rejects traversal,
 *     absolute paths, backslashes, NUL, dot-segments, dotfiles and anything
 *     outside the allowlisted roots. No filesystem access, so it is cheap and
 *     unit-testable.
 *  2. `resolveSyncPath()` — resolves against the vault root and then walks the
 *     *real* path (following symlinks on every existing ancestor) to make sure
 *     the target genuinely lives inside the vault. A string check alone can be
 *     defeated by a symlink planted in the vault.
 *
 * Allowlisted:
 *   - `<VAULT_SUBDIR>/**`  (default `Restaurants/`, includes `_Lists/` and
 *                           `_attachments/`)
 *   - `Inbox/**`
 *   - `info.md`                        (vault root, exact)
 *   - `.restauranteer-settings.json`   (vault root, exact — the one permitted
 *                                       dotfile; iOS owns this file)
 *
 * Hard-rejected: `.restauranteer/**` (the SQLite index),
 * `<subdir>/.restauranteer-tmp/**` (atomic-write staging) and every other
 * dot-prefixed segment.
 */
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { config } from '../config';
import { vaultRoot } from '../vault/share';

/** The single dotfile the sync API will serve, at the vault root only. */
export const SETTINGS_FILE = '.restauranteer-settings.json';
/** The vault-root marker file that carries `vault_id`. */
export const INFO_FILE = 'info.md';
/** Root directory (relative to the vault root) that holds the iOS share-sheet inbox. */
export const INBOX_DIR = 'Inbox';

export type PathRejection =
	| 'empty'
	| 'absolute'
	| 'traversal'
	| 'backslash'
	| 'nul'
	| 'dotfile'
	| 'not_allowlisted'
	| 'too_long'
	| 'outside_vault';

export type ValidatedPath = { ok: true; rel: string } | { ok: false; reason: PathRejection };

/** The restaurants directory name as configured (`Restaurants` by default). */
export function restaurantsRoot(): string {
	return config.vaultSubdir.split(/[/\\]/).filter(Boolean).join('/');
}

/** Top-level directories the sync API will walk and accept writes into. */
export function allowlistedDirs(): string[] {
	const roots = [restaurantsRoot(), INBOX_DIR];
	return roots.filter((r, i) => r.length > 0 && roots.indexOf(r) === i);
}

/** Vault-root-relative files (exact matches) the sync API will serve. */
export function allowlistedFiles(): string[] {
	return [INFO_FILE, SETTINGS_FILE];
}

const MAX_PATH_LEN = 1024;

/**
 * Pure string validation of a client-supplied relative path. Returns the
 * normalised (POSIX-separated) path on success.
 */
export function validateSyncPath(input: string | null | undefined): ValidatedPath {
	if (input == null) return { ok: false, reason: 'empty' };
	const raw = input.trim();
	if (raw.length === 0) return { ok: false, reason: 'empty' };
	if (raw.length > MAX_PATH_LEN) return { ok: false, reason: 'too_long' };
	if (raw.includes('\0')) return { ok: false, reason: 'nul' };
	// Windows separators are never valid on the wire — allowing them would let
	// `Restaurants\..\..\etc` slip past the segment checks on a POSIX host.
	if (raw.includes('\\')) return { ok: false, reason: 'backslash' };
	// Absolute POSIX paths and Windows drive letters / UNC prefixes.
	if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return { ok: false, reason: 'absolute' };

	const segments = raw.split('/');
	for (const segment of segments) {
		if (segment.length === 0) return { ok: false, reason: 'traversal' };
		if (segment === '.' || segment === '..') return { ok: false, reason: 'traversal' };
	}

	const rel = segments.join('/');

	// Exact root-file allowlist (this is where the one permitted dotfile lives).
	if (segments.length === 1 && allowlistedFiles().includes(rel)) return { ok: true, rel };

	// Everything else must not contain a dot-prefixed segment. This is what
	// keeps `.restauranteer/index.db`, `Restaurants/.restauranteer-tmp/**` and
	// stray `.DS_Store`/`.Etta.md.icloud` entries out.
	if (segments.some((s) => s.startsWith('.'))) return { ok: false, reason: 'dotfile' };

	if (segments.length < 2) return { ok: false, reason: 'not_allowlisted' };
	if (!allowlistedDirs().includes(segments[0])) return { ok: false, reason: 'not_allowlisted' };

	return { ok: true, rel };
}

export type ResolvedPath =
	| { ok: true; rel: string; abs: string }
	| { ok: false; reason: PathRejection };

/**
 * Validate *and* resolve a relative path to an absolute one, verifying that the
 * real (symlink-followed) location is inside the vault root. Non-existent
 * targets are allowed — creation is a legitimate operation — but every existing
 * ancestor is resolved, so a symlinked directory cannot be used to escape.
 */
export async function resolveSyncPath(input: string | null | undefined): Promise<ResolvedPath> {
	const validated = validateSyncPath(input);
	if (!validated.ok) return validated;

	const root = path.resolve(vaultRoot());
	const abs = path.resolve(root, validated.rel);
	// Redundant with the segment checks, but cheap and catches config surprises.
	if (abs !== root && !abs.startsWith(root + path.sep)) {
		return { ok: false, reason: 'outside_vault' };
	}
	if (!(await isInsideRealRoot(abs, root))) return { ok: false, reason: 'outside_vault' };
	return { ok: true, rel: validated.rel, abs };
}

/**
 * True when `abs` resolves (through symlinks) to a location inside the vault
 * root. Walks up to the deepest existing ancestor so unwritten files still get
 * their parent chain checked.
 */
async function isInsideRealRoot(abs: string, root: string): Promise<boolean> {
	let realRoot: string;
	try {
		realRoot = await realpath(root);
	} catch {
		// Vault root doesn't exist yet (fresh install) — the string check above
		// is all we have, and it already passed.
		realRoot = root;
	}

	const tail: string[] = [];
	let cursor = abs;
	for (;;) {
		try {
			const real = await realpath(cursor);
			const full = tail.length > 0 ? path.join(real, ...tail) : real;
			return full === realRoot || full.startsWith(realRoot + path.sep);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== 'ENOENT' && code !== 'ENOTDIR') return false;
			const parent = path.dirname(cursor);
			if (parent === cursor) return false;
			tail.unshift(path.basename(cursor));
			cursor = parent;
		}
	}
}

/**
 * Convert an absolute path inside the vault to its wire-format relative path.
 * Returns null when the file is outside the vault or not allowlisted (temp
 * files, the index database, dotfiles) — callers use this to decide whether a
 * deletion is worth a tombstone.
 */
export function toSyncRelPath(absPath: string): string | null {
	const root = path.resolve(vaultRoot());
	const abs = path.resolve(absPath);
	if (abs === root) return null;
	if (!abs.startsWith(root + path.sep)) return null;
	const rel = path.relative(root, abs).split(path.sep).join('/');
	const validated = validateSyncPath(rel);
	return validated.ok ? validated.rel : null;
}

/** Absolute path for a validated relative path. */
export function toAbsPath(rel: string): string {
	return path.resolve(vaultRoot(), rel);
}

/** Content type served for a vault file, keyed off its extension. */
export function contentTypeFor(rel: string): string {
	const lower = rel.toLowerCase();
	if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown; charset=utf-8';
	if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.gif')) return 'image/gif';
	if (lower.endsWith('.heic')) return 'image/heic';
	if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8';
	return 'application/octet-stream';
}

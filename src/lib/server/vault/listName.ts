/**
 * List names become filenames: `Restaurants/_Lists/<name>.md`. They are
 * user-supplied and — because `lists:` is ordinary restaurant frontmatter —
 * they also arrive from whatever someone typed in Obsidian, so an HTTP-layer
 * check alone can never be sufficient. Validation lives here and is enforced
 * at the path-building sink (`mocPath`), which is the only place a list name
 * is allowed to become a path.
 *
 * Mirrors the `validateSyncPath` shape in `../sync/paths`: a pure, total
 * string check returning a reason, so callers choose between rejecting with a
 * 400 and skipping a poisoned entry.
 */

export const MAX_LIST_NAME_LEN = 60;

export type ListNameRejection =
	| 'empty'
	| 'too_long'
	| 'nul'
	| 'separator'
	| 'traversal'
	| 'dotfile';

export type ValidatedListName =
	| { ok: true; name: string }
	| { ok: false; reason: ListNameRejection };

/**
 * The trimmed name on success. Rejects anything that could address a file
 * outside `_Lists/`, or a dot-prefixed name that every vault enumerator
 * would then skip (leaving a file on disk that the app cannot see).
 */
export function validateListName(input: string | null | undefined): ValidatedListName {
	if (input == null) return { ok: false, reason: 'empty' };
	const name = input.trim();
	if (name.length === 0) return { ok: false, reason: 'empty' };
	if (name.length > MAX_LIST_NAME_LEN) return { ok: false, reason: 'too_long' };
	if (name.includes('\0')) return { ok: false, reason: 'nul' };
	// Backslash is a plain character on POSIX but a separator on the macOS and
	// iOS clients sharing this vault — reject it on both so one vault cannot
	// mean two different paths.
	if (/[/\\\r\n]/.test(name)) return { ok: false, reason: 'separator' };
	if (name === '.' || name === '..') return { ok: false, reason: 'traversal' };
	if (name.startsWith('.')) return { ok: false, reason: 'dotfile' };
	return { ok: true, name };
}

export function isSafeListName(input: string | null | undefined): boolean {
	return validateListName(input).ok;
}

export const LIST_NAME_REJECTION_MESSAGE: Record<ListNameRejection, string> = {
	empty: 'list name cannot be empty',
	too_long: `list name too long (max ${MAX_LIST_NAME_LEN})`,
	nul: 'list name cannot include a null byte',
	separator: 'list name cannot include slashes or line breaks',
	traversal: 'list name cannot be "." or ".."',
	dotfile: 'list name cannot start with "."'
};

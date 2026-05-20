import path from 'node:path';
import { stat, unlink } from 'node:fs/promises';
import { restaurantsDir } from '../config';
import { getRestaurantByUuid } from '../db/queries';
import { readRestaurant } from './reader';
import { saveRestaurant } from './save';
import { resolveCollisionFreePath, sanitizeFilename } from './filename';
import type { Frontmatter } from './types';

export type RenameResult = {
	uuid: string;
	name: string;
	filePath: string;
	renamed: boolean;
};

/**
 * Update a restaurant's display name and rename its .md file to match.
 *
 * - If the new file path collides with another file, falls back to the
 *   suburb-suffixed name (then numeric suffixes) like initial creation.
 * - The current file is excluded from the collision check so a pure case
 *   change is treated as "no rename needed" on case-insensitive filesystems.
 * - Updates the SQLite index explicitly so the watcher's add/unlink echoes
 *   become no-ops.
 */
export async function renameRestaurant(uuid: string, newName: string): Promise<RenameResult> {
	const cleaned = newName.trim();
	if (!cleaned) throw new Error('Name cannot be empty');
	if (cleaned.length > 200) throw new Error('Name too long (max 200)');

	const indexed = getRestaurantByUuid(uuid);
	if (!indexed) throw new Error(`Restaurant ${uuid} not found`);

	const rf = await readRestaurant(indexed.file_path);
	const currentFm = rf.frontmatter as Frontmatter;
	const newFm: Frontmatter = { ...currentFm, name: cleaned };

	const oldPath = indexed.file_path;
	const newPath = await resolveTargetPath(cleaned, currentFm.suburb, oldPath);
	const lists = Array.isArray(currentFm.lists) ? (currentFm.lists as string[]) : [];

	if (newPath === oldPath) {
		await saveRestaurant(oldPath, newFm, rf.body, { affectedLists: lists });
		return { uuid, name: cleaned, filePath: oldPath, renamed: false };
	}

	// Write the new file before unlinking the old one so the SQLite row is
	// already pointing at newPath when the watcher's unlink echo for oldPath
	// arrives (deleteRestaurantByPath then finds no row at oldPath and no-ops).
	await saveRestaurant(newPath, newFm, rf.body, { affectedLists: lists });
	await unlink(oldPath);

	return { uuid, name: cleaned, filePath: newPath, renamed: true };
}

async function resolveTargetPath(
	name: string,
	suburb: unknown,
	currentPath: string
): Promise<string> {
	const dir = restaurantsDir();
	const base = sanitizeFilename(name);
	const candidate = path.join(dir, `${base}.md`);
	const currentResolved = path.resolve(currentPath);
	const candidateResolved = path.resolve(candidate);
	if (candidateResolved === currentResolved) return currentPath;
	if (!(await pathExists(candidate))) return candidate;
	const suburbStr = typeof suburb === 'string' ? suburb : undefined;
	return resolveCollisionFreePath(name, suburbStr);
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

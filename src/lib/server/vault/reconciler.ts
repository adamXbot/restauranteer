import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { readRestaurant } from './reader';
import { isMocFile } from './moc';
import { restaurantsDir } from '../config';
import { upsertRestaurant, deleteRestaurantByPath, listKnownPaths } from '../db/queries';
import { setMeta } from '../db/schema';
import { log } from '../log';

export type ReconcileResult = {
	added: number;
	updated: number;
	removed: number;
	skipped: number;
	errors: number;
};

export async function fullReconcile(): Promise<ReconcileResult> {
	log.info('Starting full vault reconcile');
	setMeta('reconcile_in_progress', '1');

	const dir = restaurantsDir();
	const files = await listMarkdownFiles(dir);
	const known = listKnownPaths();

	let added = 0;
	let updated = 0;
	let skipped = 0;
	let errors = 0;

	for (const filePath of files) {
		if (isMocFile(filePath)) {
			skipped++;
			continue;
		}
		try {
			const rf = await readRestaurant(filePath);
			if (!rf.frontmatter.id) {
				log.warn('Skipping file without id', { filePath });
				skipped++;
				known.delete(filePath);
				continue;
			}
			const prevSha = known.get(filePath);
			upsertRestaurant(rf);
			if (prevSha == null) added++;
			else if (prevSha !== rf.sha256) updated++;
			known.delete(filePath);
		} catch (err) {
			log.error('Failed to index file', { filePath, error: String(err) });
			errors++;
		}
	}

	for (const orphanPath of known.keys()) {
		deleteRestaurantByPath(orphanPath);
	}
	const removed = known.size;

	setMeta('last_reconcile', new Date().toISOString());
	setMeta('reconcile_in_progress', '0');
	log.info('Reconcile complete', { added, updated, removed, skipped, errors });
	return { added, updated, removed, skipped, errors };
}

export async function indexSingleFile(filePath: string): Promise<boolean> {
	if (isMocFile(filePath)) return false;
	try {
		const rf = await readRestaurant(filePath);
		if (!rf.frontmatter.id) {
			log.warn('Cannot index file without id', { filePath });
			return false;
		}
		upsertRestaurant(rf);
		return true;
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return false;
		log.error('Failed to index single file', { filePath, error: String(err) });
		return false;
	}
}

export function removeSingleFile(filePath: string): boolean {
	if (isMocFile(filePath)) return false;
	const removed = deleteRestaurantByPath(filePath);
	return removed !== null;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return out;
		throw err;
	}
	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue;
		if (entry.name === '_attachments') continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await listMarkdownFiles(full)));
		} else if (entry.isFile() && entry.name.endsWith('.md')) {
			out.push(full);
		}
	}
	return out;
}

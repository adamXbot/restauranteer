import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	config,
	restaurantsDir,
	listsDir,
	attachmentsDir,
	tmpDir,
	dbPath
} from '../config';
import { getDb, getMeta } from '../db/schema';
import { fullReconcile } from './reconciler';
import { regenerateAllMocs } from './moc';
import { startWatcher, stopWatcher } from './watcher';
import { cleanupOldTmpFiles } from './writer';
import { appVersion, infoMarkdown, vaultRoot } from './share';
import { log } from '../log';

let booted = false;

export async function bootVault(): Promise<void> {
	if (booted) return;
	booted = true;

	await mkdir(restaurantsDir(), { recursive: true });
	await mkdir(listsDir(), { recursive: true });
	await mkdir(attachmentsDir(), { recursive: true });
	await mkdir(tmpDir(), { recursive: true });
	await mkdir(path.dirname(dbPath()), { recursive: true });

	getDb();

	const dirty = getMeta('reconcile_in_progress') === '1';
	if (dirty) {
		log.warn('Detected dirty shutdown — last reconcile did not complete');
	}

	const cleaned = await cleanupOldTmpFiles();
	if (cleaned > 0) log.info('Cleaned old tempfiles', { count: cleaned });

	await fullReconcile();
	await regenerateAllMocs();
	await syncInfoMarkdown();
	startWatcher();

	log.info('Vault booted', {
		vaultPath: config.vaultPath,
		subdir: config.vaultSubdir,
		version: appVersion()
	});
}

/**
 * Write (or refresh) `info.md` at the vault root so other restauranteer
 * installs can check schema compatibility before importing a bundle. We only
 * rewrite when the version has actually changed to avoid touching mtime on
 * every boot.
 */
async function syncInfoMarkdown(): Promise<void> {
	const infoPath = path.join(vaultRoot(), 'info.md');
	const next = infoMarkdown();
	try {
		const existing = await readFile(infoPath, 'utf8');
		const stripDate = (s: string) => s.replace(/generated_at:.*\n/, '');
		if (stripDate(existing) === stripDate(next)) return;
	} catch {
		// File doesn't exist — fall through to write
	}
	await mkdir(path.dirname(infoPath), { recursive: true });
	await writeFile(infoPath, next, 'utf8');
	log.debug('Wrote vault info.md', { path: infoPath });
}

export async function shutdownVault(): Promise<void> {
	await stopWatcher();
}

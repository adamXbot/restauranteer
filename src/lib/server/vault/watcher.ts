import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { restaurantsDir } from '../config';
import { fullReconcile, indexSingleFile, removeSingleFile } from './reconciler';
import { isMocFile, regenerateAllMocs, writeMocForList } from './moc';
import { isSelfWrite } from './writer';
import { hashContent } from './frontmatter';
import { log } from '../log';

let watcher: FSWatcher | null = null;

const BURST_WINDOW_MS = 2_000;
const BURST_THRESHOLD = 20;
const BURST_QUIET_MS = 3_000;

let recentEventCount = 0;
let recentEventResetTimer: NodeJS.Timeout | null = null;
let burstMode = false;
let burstQuietTimer: NodeJS.Timeout | null = null;

function resetBurstCounter() {
	if (recentEventResetTimer) clearTimeout(recentEventResetTimer);
	recentEventResetTimer = setTimeout(() => {
		recentEventCount = 0;
	}, BURST_WINDOW_MS);
}

function scheduleBulkReconcile() {
	if (burstQuietTimer) clearTimeout(burstQuietTimer);
	burstQuietTimer = setTimeout(async () => {
		log.info('Burst quiet — running bulk reconcile');
		burstMode = false;
		recentEventCount = 0;
		try {
			await fullReconcile();
		} catch (err) {
			log.error('Bulk reconcile failed', { error: String(err) });
		}
	}, BURST_QUIET_MS);
}

function noteEvent() {
	recentEventCount++;
	resetBurstCounter();
	if (recentEventCount > BURST_THRESHOLD && !burstMode) {
		log.warn('Entering burst mode (filesystem storm detected)');
		burstMode = true;
	}
	if (burstMode) scheduleBulkReconcile();
}

function shouldIgnore(filePath: string, rootDir: string): boolean {
	if (filePath === rootDir) return false;
	const rel = path.relative(rootDir, filePath);
	if (rel.startsWith('..')) return true;
	const segments = rel.split(path.sep);
	if (segments.some((s) => s.startsWith('.'))) return true;
	if (segments[0] === '_attachments') return true;
	return false;
}

async function handleAddOrChange(filePath: string) {
	let content: string;
	try {
		content = (await readFile(filePath)).toString('utf8');
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return;
		log.error('Failed to read changed file', { filePath, error: String(err) });
		return;
	}

	const sha = hashContent(content);
	if (isSelfWrite(filePath, sha)) {
		log.debug('Suppressed self-write echo', { filePath });
		return;
	}

	noteEvent();
	if (burstMode) return;

	if (isMocFile(filePath)) {
		const listName = path.basename(filePath, '.md');
		log.info('Reverting external MOC edit', { listName });
		try {
			await writeMocForList(listName);
		} catch (err) {
			log.error('Failed to revert MOC', { listName, error: String(err) });
		}
		return;
	}

	const indexed = await indexSingleFile(filePath);
	if (indexed) {
		try {
			await regenerateAllMocs();
		} catch (err) {
			log.error('Failed to regenerate MOCs', { error: String(err) });
		}
	}
}

function handleUnlink(filePath: string) {
	if (isMocFile(filePath)) return;
	noteEvent();
	if (burstMode) return;
	const removed = removeSingleFile(filePath);
	if (removed) {
		regenerateAllMocs().catch((err) =>
			log.error('Failed to regenerate MOCs after unlink', { error: String(err) })
		);
	}
}

export function startWatcher(): FSWatcher {
	if (watcher) return watcher;
	const dir = restaurantsDir();
	log.info('Starting watcher', { dir });

	watcher = chokidar.watch(dir, {
		persistent: true,
		ignoreInitial: true,
		awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
		ignored: (filePath) => shouldIgnore(filePath, dir)
	});

	watcher.on('add', (p) => void handleAddOrChange(p));
	watcher.on('change', (p) => void handleAddOrChange(p));
	watcher.on('unlink', handleUnlink);
	watcher.on('error', (err) => log.error('Watcher error', { error: String(err) }));
	watcher.on('ready', () => log.info('Watcher ready'));

	return watcher;
}

export async function stopWatcher(): Promise<void> {
	if (!watcher) return;
	await watcher.close();
	watcher = null;
	if (recentEventResetTimer) clearTimeout(recentEventResetTimer);
	if (burstQuietTimer) clearTimeout(burstQuietTimer);
	recentEventResetTimer = null;
	burstQuietTimer = null;
	burstMode = false;
	recentEventCount = 0;
}

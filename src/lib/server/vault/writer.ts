import { mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { hashContent, stringify } from './frontmatter';
import type { Frontmatter } from './types';
import { tmpDir } from '../config';

const SELF_WRITE_TTL_MS = 10_000;
type SelfWriteEntry = { hash: string; expiresAt: number };
const selfWrites = new Map<string, SelfWriteEntry[]>();

function recordSelfWrite(filePath: string, sha: string) {
	const entries = selfWrites.get(filePath) ?? [];
	entries.push({ hash: sha, expiresAt: Date.now() + SELF_WRITE_TTL_MS });
	selfWrites.set(filePath, entries);
}

export function isSelfWrite(filePath: string, sha: string): boolean {
	const entries = selfWrites.get(filePath);
	if (!entries) return false;
	const now = Date.now();
	const fresh = entries.filter((e) => e.expiresAt > now);
	if (fresh.length === 0) {
		selfWrites.delete(filePath);
		return false;
	}
	const idx = fresh.findIndex((e) => e.hash === sha);
	if (idx < 0) {
		selfWrites.set(filePath, fresh);
		return false;
	}
	fresh.splice(idx, 1);
	if (fresh.length === 0) selfWrites.delete(filePath);
	else selfWrites.set(filePath, fresh);
	return true;
}

async function ensureTmp(): Promise<string> {
	const dir = tmpDir();
	await mkdir(dir, { recursive: true });
	return dir;
}

async function writeTempThenRename(
	finalPath: string,
	write: (handle: Awaited<ReturnType<typeof open>>) => Promise<void>
): Promise<void> {
	const tmpRoot = await ensureTmp();
	await mkdir(path.dirname(finalPath), { recursive: true });
	const tmpName = `${path.basename(finalPath)}.tmp-${randomUUID()}`;
	const tmpPath = path.join(tmpRoot, tmpName);
	const fh = await open(tmpPath, 'w');
	try {
		await write(fh);
		await fh.sync();
	} finally {
		await fh.close();
	}
	await rename(tmpPath, finalPath);
}

export async function atomicWriteText(
	filePath: string,
	content: string
): Promise<{ sha: string; mtime: number }> {
	const sha = hashContent(content);
	recordSelfWrite(filePath, sha);
	await writeTempThenRename(filePath, async (fh) => {
		await fh.writeFile(content, 'utf8');
	});
	const stats = await stat(filePath);
	return { sha, mtime: stats.mtimeMs };
}

export async function atomicWriteBinary(filePath: string, data: Uint8Array): Promise<void> {
	await writeTempThenRename(filePath, async (fh) => {
		await fh.writeFile(data);
	});
}

export async function writeMarkdownFile(
	filePath: string,
	frontmatter: Frontmatter,
	body: string
): Promise<{ sha: string; mtime: number; content: string }> {
	const content = stringify(frontmatter, body);
	const { sha, mtime } = await atomicWriteText(filePath, content);
	return { sha, mtime, content };
}

export async function cleanupOldTmpFiles(): Promise<number> {
	const dir = tmpDir();
	try {
		const entries = await readdir(dir);
		const oneHourAgo = Date.now() - 3600_000;
		let cleaned = 0;
		for (const name of entries) {
			const full = path.join(dir, name);
			try {
				const s = await stat(full);
				if (s.mtimeMs < oneHourAgo) {
					await unlink(full);
					cleaned++;
				}
			} catch {
				// ignore individual file errors
			}
		}
		return cleaned;
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return 0;
		throw err;
	}
}

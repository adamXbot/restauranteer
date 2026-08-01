/**
 * The vault's stable identity.
 *
 * A client refuses to sync against a vault it hasn't been paired with — that is
 * what stops someone pointing a phone at the wrong server and silently merging
 * two unrelated vaults. So the id has to survive everything that is *supposed*
 * to be disposable: it lives in `info.md`'s frontmatter (a real vault file that
 * syncs and gets backed up), not only in the SQLite index, which is explicitly
 * rebuildable. `meta` caches it so the hot path doesn't read the file.
 *
 * Precedence: info.md → meta cache → mint a fresh UUID. It is never
 * regenerated when one is already present.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getMeta, setMeta } from '../db/schema';
import { parse, stringify } from '../vault/frontmatter';
import { infoMarkdown, vaultRoot } from '../vault/share';
import { atomicWriteText } from '../vault/writer';
import { log } from '../log';

export const VAULT_ID_META_KEY = 'vault_id';

export function infoPath(): string {
	return path.join(vaultRoot(), 'info.md');
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function coerceId(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Read `vault_id` out of `info.md`'s frontmatter, or null if absent. */
export async function readVaultIdFromInfo(): Promise<string | null> {
	try {
		const raw = await readFile(infoPath(), 'utf8');
		return coerceId(parse(raw).frontmatter.vault_id);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== 'ENOENT') log.warn('Could not read info.md for vault_id', { error: String(err) });
		return null;
	}
}

/**
 * Stamp `vault_id` onto `info.md`, preserving whatever else the file holds.
 * Creates the file from the standard template when it is missing.
 */
async function writeVaultIdToInfo(id: string): Promise<void> {
	const file = infoPath();
	let source: string;
	try {
		source = await readFile(file, 'utf8');
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== 'ENOENT') throw err;
		source = infoMarkdown();
	}
	const { frontmatter, body } = parse(source);
	if (coerceId(frontmatter.vault_id) === id) return;
	await atomicWriteText(file, stringify({ ...frontmatter, vault_id: id }, body));
	log.info('Stamped vault_id on info.md', { vault_id: id });
}

/**
 * Resolve the vault id, minting and persisting one on first call. Safe to call
 * repeatedly; only the very first call for a fresh vault writes anything.
 */
export async function ensureVaultId(): Promise<string> {
	const cached = coerceId(getMeta(VAULT_ID_META_KEY));
	const fromInfo = await readVaultIdFromInfo();

	if (fromInfo) {
		// info.md is authoritative — it survives index rebuilds.
		if (cached !== fromInfo) setMeta(VAULT_ID_META_KEY, fromInfo);
		return fromInfo;
	}

	const id = cached ?? randomUUID();
	if (cached !== id) setMeta(VAULT_ID_META_KEY, id);
	try {
		await writeVaultIdToInfo(id);
	} catch (err) {
		// A read-only vault root still gets a usable (cached) id; the write is
		// retried on the next boot.
		log.warn('Could not persist vault_id to info.md', { error: String(err) });
	}
	return id;
}

/** Cached id without touching the filesystem. Null before the first mint. */
export function cachedVaultId(): string | null {
	return coerceId(getMeta(VAULT_ID_META_KEY));
}

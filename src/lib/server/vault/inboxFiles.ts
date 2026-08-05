/**
 * The synced inbox convention the iOS share extension writes:
 * `{vault}/Inbox/YYYYMMDD-HHMMSS-<id>.md`, frontmatter
 * `kind: restauranteer_inbox` with `url`/`title`/`source`/`shared_at`
 * (+ `excerpt`/`image_url`/`scraped_at` once the app has enriched it).
 *
 * The phone treats these files as its inbox *store* — items live there until
 * triaged — so the web must never consume one just by reading it. Adoption
 * mirrors each file into `link_inbox` (numeric ids keep the whole UI
 * unchanged) and remembers the mapping in `vault_file`; the file is deleted
 * only when the item is attached or dismissed *here*, exactly the semantic
 * the phone applies. If the phone triages first the file vanishes, and the
 * next reconcile drops the mirrored row.
 */
import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { getDb } from '../db/schema';
import { inboxDir } from '../config';
import { log } from '../log';

export type InboxFileEntry = {
	/** Basename, e.g. `20260712-131502-9f3c27ab.md` — the `vault_file` key. */
	file: string;
	url: string;
	title: string;
	source: string;
	excerpt: string | null;
	image_url: string | null;
	/** ms since epoch, from `shared_at` (falls back to now). */
	shared_at: number;
};

/** Parse every `kind: restauranteer_inbox` file under `{vault}/Inbox/`. */
export function listInboxFiles(): InboxFileEntry[] {
	let names: string[];
	try {
		names = readdirSync(inboxDir());
	} catch {
		return []; // No Inbox/ directory — nothing shared from a phone yet.
	}
	const entries: InboxFileEntry[] = [];
	for (const name of names) {
		if (!name.endsWith('.md') || name.startsWith('.')) continue;
		let parsed: matter.GrayMatterFile<string>;
		try {
			parsed = matter(readFileSync(path.join(inboxDir(), name), 'utf8'));
		} catch {
			continue; // Unreadable/corrupt: leave it for the phone to deal with.
		}
		const fm = parsed.data as Record<string, unknown>;
		if (fm.kind !== 'restauranteer_inbox') continue;
		const url = typeof fm.url === 'string' ? fm.url.trim() : '';
		if (!url) continue;
		const sharedAt =
			typeof fm.shared_at === 'string' ? Date.parse(fm.shared_at) : Number.NaN;
		entries.push({
			file: name,
			url,
			title:
				typeof fm.title === 'string' && fm.title.trim()
					? fm.title.trim()
					: fallbackTitle(url),
			source: typeof fm.source === 'string' && fm.source ? fm.source : 'shared',
			excerpt: typeof fm.excerpt === 'string' && fm.excerpt ? fm.excerpt : null,
			image_url: typeof fm.image_url === 'string' && fm.image_url ? fm.image_url : null,
			shared_at: Number.isFinite(sharedAt) ? sharedAt : Date.now()
		});
	}
	return entries;
}

/** The phone's own fallback: the host, for a share with no usable title. */
function fallbackTitle(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

/**
 * Mirror vault inbox files into `link_inbox` and drop mirrored rows whose
 * file the phone has already triaged. Cheap enough to run on every inbox
 * listing: one readdir plus a parse per *new* file.
 */
export function reconcileInboxFiles(): void {
	const db = getDb();
	const entries = listInboxFiles();
	const present = new Set(entries.map((e) => e.file));

	// Rows the phone already consumed: mirrored (vault_file set), file gone.
	const mirrored = db
		.prepare('SELECT id, vault_file FROM link_inbox WHERE vault_file IS NOT NULL')
		.all() as { id: number; vault_file: string }[];
	for (const row of mirrored) {
		if (!present.has(row.vault_file)) {
			db.prepare('DELETE FROM link_inbox WHERE id = ?').run(row.id);
		}
	}

	const known = new Set(mirrored.map((r) => r.vault_file));
	for (const entry of entries) {
		if (known.has(entry.file)) continue;
		// A URL shared on the phone may already sit in the web inbox (or the
		// other way round). UNIQUE(url) would reject the insert; instead the
		// existing row adopts the mapping, so triaging it consumes the file.
		const existing = db
			.prepare('SELECT id FROM link_inbox WHERE url = ?')
			.get(entry.url) as { id: number } | undefined;
		if (existing) {
			db.prepare('UPDATE link_inbox SET vault_file = ? WHERE id = ?').run(
				entry.file,
				existing.id
			);
			continue;
		}
		db.prepare(
			`INSERT INTO link_inbox (url, source, title, excerpt, image_url, suggested_uuid, created_at, vault_file)
			 VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
		).run(
			entry.url,
			entry.source,
			entry.title,
			entry.excerpt,
			entry.image_url,
			entry.shared_at,
			entry.file
		);
	}
}

/**
 * Delete the vault file behind a triaged row, if any. Idempotent: the phone
 * may have consumed it first, and a missing file is success, not failure.
 */
export function consumeInboxFile(vaultFile: string | null | undefined): void {
	if (!vaultFile) return;
	// Basenames only — a mapping that somehow carries a path must not let
	// the delete escape the Inbox directory.
	if (vaultFile.includes('/') || vaultFile.includes('..')) return;
	try {
		unlinkSync(path.join(inboxDir(), vaultFile));
	} catch {
		log.debug?.('Inbox file already gone', { vaultFile });
	}
}

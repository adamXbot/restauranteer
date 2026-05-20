import { getDb } from './db/schema';
import { findByArticleUrl, searchVaultFts } from './db/queries';
import { extractGenericLinkPreview } from './providers/scraper/genericLink';
import { linkRefToRestaurant } from './vault/createFromArticle';
import type { ArticleRef } from './providers/scraper/types';
import { log } from './log';

export type InboxItem = {
	id: number;
	url: string;
	source: string;
	title: string;
	excerpt: string | null;
	image_url: string | null;
	suggested_uuid: string | null;
	created_at: number;
};

export type InboxSuggestion = {
	uuid: string;
	name: string;
	suburb: string | null;
};

type Row = InboxItem;

export function listInbox(): InboxItem[] {
	return getDb()
		.prepare('SELECT * FROM link_inbox ORDER BY created_at DESC')
		.all() as Row[];
}

export function inboxCount(): number {
	return (getDb().prepare('SELECT COUNT(*) AS c FROM link_inbox').get() as { c: number }).c;
}

export function getInboxItem(id: number): InboxItem | null {
	const row = getDb().prepare('SELECT * FROM link_inbox WHERE id = ?').get(id) as
		| Row
		| undefined;
	return row ?? null;
}

export function suggestionsForTitle(title: string, limit = 5): InboxSuggestion[] {
	const q = title.trim();
	if (q.length < 2) return [];
	const hits = searchVaultFts(q, limit);
	return hits.map((r) => ({
		uuid: r.uuid,
		name: r.name,
		suburb: (r.frontmatter.suburb as string | undefined) ?? null
	}));
}

export type AddToInboxResult =
	| { status: 'added'; item: InboxItem; suggestions: InboxSuggestion[] }
	| { status: 'already_pending'; item: InboxItem; suggestions: InboxSuggestion[] }
	| { status: 'already_attached'; uuid: string; filePath: string };

export async function addToInbox(rawUrl: string): Promise<AddToInboxResult> {
	const url = rawUrl.trim();
	if (!/^https?:\/\//i.test(url)) {
		throw new Error('URL must start with http:// or https://');
	}

	const attached = findByArticleUrl(url);
	if (attached) {
		return { status: 'already_attached', uuid: attached.uuid, filePath: attached.file_path };
	}

	const existing = getDb()
		.prepare('SELECT * FROM link_inbox WHERE url = ?')
		.get(url) as Row | undefined;
	if (existing) {
		return {
			status: 'already_pending',
			item: existing,
			suggestions: suggestionsForTitle(existing.title)
		};
	}

	let preview;
	try {
		preview = await extractGenericLinkPreview(url);
	} catch (e) {
		log.error('Inbox extract failed', { url, error: String(e) });
		throw new Error('Failed to read the link. Check the URL and try again.');
	}

	const created_at = Date.now();
	const suggestions = suggestionsForTitle(preview.ref.title);
	const suggested = suggestions[0]?.uuid ?? null;

	const info = getDb()
		.prepare(
			`INSERT INTO link_inbox (url, source, title, excerpt, image_url, suggested_uuid, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			preview.ref.url,
			preview.ref.source,
			preview.ref.title,
			preview.ref.excerpt,
			preview.image_url,
			suggested,
			created_at
		);

	const item: InboxItem = {
		id: Number(info.lastInsertRowid),
		url: preview.ref.url,
		source: preview.ref.source,
		title: preview.ref.title,
		excerpt: preview.ref.excerpt,
		image_url: preview.image_url,
		suggested_uuid: suggested,
		created_at
	};
	return { status: 'added', item, suggestions };
}

export async function attachInboxToRestaurant(
	id: number,
	uuid: string
): Promise<{ ok: true; uuid: string }> {
	const item = getInboxItem(id);
	if (!item) throw new Error('Inbox item not found');
	const ref: ArticleRef = {
		source: item.source,
		url: item.url,
		title: item.title,
		excerpt: item.excerpt,
		fetched_at: new Date(item.created_at).toISOString()
	};
	await linkRefToRestaurant(uuid, ref);
	getDb().prepare('DELETE FROM link_inbox WHERE id = ?').run(id);
	return { ok: true, uuid };
}

export function dismissInbox(id: number): boolean {
	const info = getDb().prepare('DELETE FROM link_inbox WHERE id = ?').run(id);
	return info.changes > 0;
}

import type { PageServerLoad } from './$types';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { env } from '$env/dynamic/private';
import { config, attachmentsDir } from '$lib/server/config';
import { cacheStats } from '$lib/server/providers/cache';
import { getDb, getMeta } from '$lib/server/db/schema';
import { getPreferences } from '$lib/server/preferences';

type AttachmentGroup = { slug: string; bytes: number; files: number };

async function attachmentStats(): Promise<{
	total_bytes: number;
	total_files: number;
	by_restaurant: AttachmentGroup[];
}> {
	const root = attachmentsDir();
	const groups: AttachmentGroup[] = [];
	let total_bytes = 0;
	let total_files = 0;

	let entries: string[];
	try {
		entries = await readdir(root);
	} catch {
		return { total_bytes: 0, total_files: 0, by_restaurant: [] };
	}

	async function walk(dir: string, acc: { bytes: number; files: number }): Promise<void> {
		const items = await readdir(dir, { withFileTypes: true });
		for (const it of items) {
			if (it.name.startsWith('.')) continue;
			const p = path.join(dir, it.name);
			if (it.isDirectory()) {
				await walk(p, acc);
			} else if (it.isFile()) {
				const st = await stat(p);
				acc.bytes += st.size;
				acc.files += 1;
			}
		}
	}

	for (const slug of entries) {
		if (slug.startsWith('.')) continue;
		const sub = path.join(root, slug);
		let s;
		try {
			s = await stat(sub);
		} catch {
			continue;
		}
		if (!s.isDirectory()) continue;
		const acc = { bytes: 0, files: 0 };
		try {
			await walk(sub, acc);
		} catch {
			continue;
		}
		if (acc.files > 0) {
			groups.push({ slug, bytes: acc.bytes, files: acc.files });
			total_bytes += acc.bytes;
			total_files += acc.files;
		}
	}

	groups.sort((a, b) => b.bytes - a.bytes);
	return { total_bytes, total_files, by_restaurant: groups };
}

export const load: PageServerLoad = async () => {
	const db = getDb();
	const restaurantCount = (
		db.prepare('SELECT COUNT(*) AS c FROM restaurants').get() as { c: number }
	).c;
	const listCount = (
		db.prepare('SELECT COUNT(DISTINCT list_name) AS c FROM lists').get() as { c: number }
	).c;
	const tagCount = (
		db.prepare('SELECT COUNT(DISTINCT tag) AS c FROM tags').get() as { c: number }
	).c;
	const articleCount = (
		db.prepare('SELECT COUNT(*) AS c FROM article_urls').get() as { c: number }
	).c;

	return {
		vault: {
			path: config.vaultPath,
			subdir: config.vaultSubdir,
			obsidianVaultName: config.obsidianVaultName
		},
		apiKeys: {
			google_places: !!env.GOOGLE_PLACES_API_KEY,
			google_maps: !!env.GOOGLE_MAPS_PUBLIC_KEY,
			mapbox: !!env.MAPBOX_PUBLIC_TOKEN,
			apple_mapkit: !!(env.APPLE_MAPKIT_TEAM_ID && env.APPLE_MAPKIT_KEY_ID),
			yelp: !!env.YELP_API_KEY
		},
		stats: {
			restaurants: restaurantCount,
			lists: listCount,
			tags: tagCount,
			articles: articleCount
		},
		cache: cacheStats(),
		attachments: await attachmentStats(),
		preferences: getPreferences(),
		lastReconcile: getMeta('last_reconcile'),
		dirtyShutdown: getMeta('reconcile_in_progress') === '1'
	};
};

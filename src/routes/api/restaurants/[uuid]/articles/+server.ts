import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findAdapterForUrl } from '$lib/server/providers/scraper/registry';
import { CACHE_FOREVER, fetchCached } from '$lib/server/providers/cache';
import {
	linkArticleToRestaurant,
	linkRefToRestaurant
} from '$lib/server/vault/createFromArticle';
import { extractGenericLink } from '$lib/server/providers/scraper/genericLink';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import { saveRestaurant } from '$lib/server/vault/save';
import type { ArticleRef } from '$lib/server/providers/scraper/types';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ params, request }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');

	const body = (await request.json().catch(() => null)) as {
		url?: string;
		refresh?: boolean;
	} | null;
	if (!body?.url || typeof body.url !== 'string') throw error(400, 'url required');
	const forceRefresh = body.refresh === true;

	const adapter = findAdapterForUrl(body.url);

	// Generic-link path — any URL we don't have a structured adapter for is
	// saved with best-effort OpenGraph metadata.
	if (!adapter) {
		try {
			const ref = await fetchCached(
				'generic.link',
				body.url,
				CACHE_FOREVER,
				() => extractGenericLink(body.url!),
				{ forceRefresh }
			);
			const result = await linkRefToRestaurant(params.uuid, ref);
			return json(result);
		} catch (e) {
			log.error('Generic link failed', { url: body.url, error: String(e) });
			throw error(500, String(e));
		}
	}

	let extracted;
	try {
		extracted = await fetchCached(
			`scrape.${adapter.id}.article`,
			body.url,
			CACHE_FOREVER,
			() => adapter.extract(body.url!),
			{ forceRefresh }
		);
	} catch (e) {
		log.error('Link extract failed', { url: body.url, error: String(e) });
		throw error(502, `Failed to extract: ${String(e)}`);
	}

	try {
		const result = await linkArticleToRestaurant(params.uuid, extracted);
		return json(result);
	} catch (e) {
		log.error('Link save failed', { url: body.url, error: String(e) });
		throw error(500, String(e));
	}
};

export const DELETE: RequestHandler = async ({ params, url }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');

	const articleUrl = url.searchParams.get('url');
	if (!articleUrl) throw error(400, 'url query parameter required');

	const rf = await readRestaurant(indexed.file_path);
	const existing = Array.isArray(rf.frontmatter.articles)
		? (rf.frontmatter.articles as ArticleRef[])
		: [];
	const next = existing.filter((a) => a.url !== articleUrl);
	if (next.length === existing.length) {
		return json({ removed: false, articles: existing });
	}

	const newFm = { ...rf.frontmatter, articles: next };
	await saveRestaurant(indexed.file_path, newFm, rf.body);
	return json({ removed: true, articles: next });
};

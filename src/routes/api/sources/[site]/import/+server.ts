import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdapter } from '$lib/server/providers/scraper/registry';
import { CACHE_FOREVER, fetchCached } from '$lib/server/providers/cache';
import {
	createOrLinkFromArticle,
	linkArticleToRestaurant
} from '$lib/server/vault/createFromArticle';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ params, request, url }) => {
	const adapter = getAdapter(params.site);
	if (!adapter) throw error(404, `Unknown source: ${params.site}`);

	const body = (await request.json().catch(() => null)) as {
		url?: string;
		link_to_uuid?: string;
		refresh?: boolean;
	} | null;
	if (!body?.url || typeof body.url !== 'string') throw error(400, 'url required');
	if (!adapter.matchesUrl(body.url)) {
		throw error(400, `URL does not look like a ${adapter.label} article`);
	}
	const forceRefresh = body.refresh === true || url.searchParams.get('refresh') === '1';

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
		log.error('Import extract failed', { url: body.url, error: String(e) });
		throw error(502, `Failed to extract: ${String(e)}`);
	}

	try {
		if (body.link_to_uuid) {
			const result = await linkArticleToRestaurant(body.link_to_uuid, extracted);
			return json(result, { status: 200 });
		}
		const result = await createOrLinkFromArticle(extracted);
		return json(result, { status: result.alreadyExisted ? 200 : 201 });
	} catch (e) {
		log.error('Import save failed', { url: body.url, error: String(e) });
		throw error(500, `Failed to save: ${String(e)}`);
	}
};

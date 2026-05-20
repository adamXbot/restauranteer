import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdapter } from '$lib/server/providers/scraper/registry';
import { CACHE_FOREVER, fetchCached } from '$lib/server/providers/cache';
import { findByArticleUrl } from '$lib/server/db/queries';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ params, request, url }) => {
	const adapter = getAdapter(params.site);
	if (!adapter) throw error(404, `Unknown source: ${params.site}`);

	const body = (await request.json().catch(() => null)) as {
		url?: string;
		refresh?: boolean;
	} | null;
	if (!body?.url || typeof body.url !== 'string') {
		throw error(400, 'url required');
	}
	if (!adapter.matchesUrl(body.url)) {
		throw error(400, `URL does not look like a ${adapter.label} article`);
	}
	const forceRefresh = body.refresh === true || url.searchParams.get('refresh') === '1';

	try {
		const extracted = await fetchCached(
			`scrape.${adapter.id}.article`,
			body.url,
			CACHE_FOREVER,
			() => adapter.extract(body.url!),
			{ forceRefresh }
		);
		return json({
			extracted,
			vault_uuid: findByArticleUrl(extracted.url)?.uuid ?? null
		});
	} catch (e) {
		log.error('Extract failed', { site: params.site, url: body.url, error: String(e) });
		throw error(502, `Failed to extract: ${String(e)}`);
	}
};

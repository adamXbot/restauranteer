import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdapter } from '$lib/server/providers/scraper/registry';
import { CACHE_FOREVER, fetchCached } from '$lib/server/providers/cache';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ params, url }) => {
	const adapter = getAdapter(params.site);
	if (!adapter) throw error(404, `Unknown source: ${params.site}`);
	if (!adapter.listSuburbs) {
		throw error(400, `${adapter.label} doesn't expose a suburb list`);
	}

	const city = url.searchParams.get('city');
	if (!city) throw error(400, 'city required');
	if (!adapter.cities.some((c) => c.id === city)) {
		throw error(400, `City "${city}" not supported by ${adapter.label}`);
	}
	const forceRefresh = url.searchParams.get('refresh') === '1';

	try {
		const suburbs = await fetchCached(
			`scrape.${adapter.id}.suburbs`,
			city,
			CACHE_FOREVER,
			() => adapter.listSuburbs!(city),
			{ forceRefresh }
		);
		return json({ suburbs });
	} catch (e) {
		log.error('Suburb list failed', { site: params.site, city, error: String(e) });
		throw error(502, `Failed to list suburbs: ${String(e)}`);
	}
};

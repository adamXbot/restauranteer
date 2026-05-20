import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAdapter } from '$lib/server/providers/scraper/registry';
import { CACHE_FOREVER, fetchCached } from '$lib/server/providers/cache';
import { findByArticleUrl } from '$lib/server/db/queries';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ params, url }) => {
	const adapter = getAdapter(params.site);
	if (!adapter) throw error(404, `Unknown source: ${params.site}`);

	const city = url.searchParams.get('city');
	const suburb = url.searchParams.get('suburb');
	if (!city) throw error(400, 'city required');
	if (!adapter.cities.some((c) => c.id === city)) {
		throw error(400, `City "${city}" not supported by ${adapter.label}`);
	}
	const forceRefresh = url.searchParams.get('refresh') === '1';
	const wantsSuburb = suburb !== null && suburb.trim().length > 0;

	let listings;
	try {
		if (wantsSuburb) {
			if (!adapter.discoverBySuburb || !adapter.suburbBrowsable) {
				throw error(400, `${adapter.label} doesn't support suburb browsing`);
			}
			const trimmed = suburb!.trim();
			listings = await fetchCached(
				`scrape.${adapter.id}.discover`,
				`${city}/${trimmed.toLowerCase()}`,
				CACHE_FOREVER,
				() => adapter.discoverBySuburb!(city, trimmed),
				{ forceRefresh }
			);
		} else {
			if (!adapter.discoverByCity || !adapter.cityBrowsable) {
				throw error(400, `${adapter.label} doesn't support city-wide browsing`);
			}
			listings = await fetchCached(
				`scrape.${adapter.id}.discover`,
				city,
				CACHE_FOREVER,
				() => adapter.discoverByCity!(city),
				{ forceRefresh }
			);
		}
	} catch (e) {
		log.error('Discover failed', { site: params.site, city, suburb, error: String(e) });
		throw error(502, `Failed to fetch directory: ${String(e)}`);
	}

	return json({
		listings: listings.map((l) => ({
			...l,
			vault_uuid: findByArticleUrl(l.url)?.uuid ?? null
		}))
	});
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adapters } from '$lib/server/providers/scraper/registry';
import type { SourceListing } from '$lib/server/providers/scraper/types';
import { CACHE_FOREVER, fetchCached } from '$lib/server/providers/cache';
import { findByArticleUrl } from '$lib/server/db/queries';
import { log } from '$lib/server/log';

const PER_FEED = 12;

/**
 * Aggregated "From the guides" feeds for the Discover page. Fans out across
 * every browsable adapter and returns one feed per source that can produce one
 * for the given params. Sources that can't feed here (single-article-only
 * adapters, or suburb-only adapters when no suburb is supplied) are skipped
 * silently, as is any source whose scrape fails — the page shows whatever came
 * back rather than erroring. Shares cache keys with /api/sources/{id}/discover.
 */
export const GET: RequestHandler = async ({ url }) => {
	const city = (url.searchParams.get('city') || 'melbourne').toLowerCase();
	const suburbRaw = url.searchParams.get('suburb');
	const suburb = suburbRaw && suburbRaw.trim() ? suburbRaw.trim() : null;
	const forceRefresh = url.searchParams.get('refresh') === '1';

	const feeds: Array<{
		source: string;
		label: string;
		scope: 'city' | 'suburb';
		city: string;
		suburb: string | null;
		listings: Array<SourceListing & { vault_uuid: string | null }>;
	}> = [];

	for (const a of adapters) {
		if (!a.cities.some((c) => c.id === city)) continue;

		let scope: 'city' | 'suburb';
		let cacheKey: string;
		let fetchListings: () => Promise<SourceListing[]>;
		if (a.cityBrowsable && a.discoverByCity) {
			scope = 'city';
			cacheKey = city;
			fetchListings = () => a.discoverByCity!(city);
		} else if (suburb && a.suburbBrowsable && a.discoverBySuburb) {
			scope = 'suburb';
			cacheKey = `${city}/${suburb.toLowerCase()}`;
			fetchListings = () => a.discoverBySuburb!(city, suburb);
		} else {
			continue; // this source can't feed with the current params
		}

		try {
			const listings = await fetchCached(
				`scrape.${a.id}.discover`,
				cacheKey,
				CACHE_FOREVER,
				fetchListings,
				{ forceRefresh }
			);
			if (listings.length === 0) continue;
			feeds.push({
				source: a.id,
				label: a.label,
				scope,
				city,
				suburb: scope === 'suburb' ? suburb : null,
				listings: listings.slice(0, PER_FEED).map((l) => ({
					...l,
					vault_uuid: findByArticleUrl(l.url)?.uuid ?? null
				}))
			});
		} catch (e) {
			log.error('Discover feed failed', { site: a.id, city, suburb, error: String(e) });
		}
	}

	return json({ city, suburb, feeds });
};

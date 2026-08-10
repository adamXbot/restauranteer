import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { autocomplete, hasGoogleKey } from '$lib/server/providers/google';
import { appleSearchPlaces, hasAppleSearch } from '$lib/server/providers/appleSearch';
import { searchVaultFtsHits } from '$lib/server/db/queries';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const latStr = url.searchParams.get('lat');
	const lngStr = url.searchParams.get('lng');
	const sessionToken = url.searchParams.get('session') ?? undefined;
	const lat = latStr ? Number(latStr) : NaN;
	const lng = lngStr ? Number(lngStr) : NaN;

	if (!q) {
		return json({
			vault: [],
			google: [],
			apple: [],
			google_enabled: hasGoogleKey(),
			apple_enabled: hasAppleSearch()
		});
	}

	// Hits, not bare rows: a cuisine or dish-note match whose reason isn't
	// shown reads as a wrong answer (the whole "search doesn't work" report).
	const hits = searchVaultFtsHits(q, 10);
	const vault = hits.map((hit) => ({
		uuid: hit.restaurant.uuid,
		name: hit.restaurant.name,
		address: (hit.restaurant.frontmatter.address as string | undefined) ?? null,
		suburb: (hit.restaurant.frontmatter.suburb as string | undefined) ?? null,
		google_place_id: hit.restaurant.google_place_id,
		match_field: hit.field,
		match_snippet: hit.snippet
	}));
	const knownIds = new Set(vault.map((v) => v.google_place_id).filter(Boolean));
	// Same suppression for Apple, from the hits we already have.
	const knownAppleIds = new Set(
		hits
			.map((hit) => (hit.restaurant.frontmatter.place_ids as Record<string, string> | undefined))
			.map((ids) => ids?.apple)
			.filter(Boolean)
	);

	let google: Awaited<ReturnType<typeof autocomplete>> = [];
	if (hasGoogleKey()) {
		try {
			google = await autocomplete(q, {
				lat: Number.isFinite(lat) ? lat : undefined,
				lng: Number.isFinite(lng) ? lng : undefined,
				sessionToken
			});
			google = google.filter((g) => !knownIds.has(g.place_id));
		} catch (e) {
			log.error('Autocomplete error', { error: String(e) });
		}
	}

	// Apple runs on the credentials the map already uses, so it is the lane
	// that needs no Google billing. It never throws — a failure just leaves
	// the other two lanes standing.
	const apple = await appleSearchPlaces(q, {
		lat: Number.isFinite(lat) ? lat : undefined,
		lng: Number.isFinite(lng) ? lng : undefined,
		limit: 8
	});
	return json({
		vault,
		google,
		apple: apple.filter((a) => !a.place_id || !knownAppleIds.has(a.place_id)),
		google_enabled: hasGoogleKey(),
		apple_enabled: hasAppleSearch()
	});
};

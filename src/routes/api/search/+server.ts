import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { autocomplete, hasGoogleKey } from '$lib/server/providers/google';
import { searchVaultFtsHits } from '$lib/server/db/queries';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const latStr = url.searchParams.get('lat');
	const lngStr = url.searchParams.get('lng');
	const sessionToken = url.searchParams.get('session') ?? undefined;
	const lat = latStr ? Number(latStr) : NaN;
	const lng = lngStr ? Number(lngStr) : NaN;

	if (!q) return json({ vault: [], google: [], google_enabled: hasGoogleKey() });

	// Hits, not bare rows: a cuisine or dish-note match whose reason isn't
	// shown reads as a wrong answer (the whole "search doesn't work" report).
	const vault = searchVaultFtsHits(q, 10).map((hit) => ({
		uuid: hit.restaurant.uuid,
		name: hit.restaurant.name,
		address: (hit.restaurant.frontmatter.address as string | undefined) ?? null,
		suburb: (hit.restaurant.frontmatter.suburb as string | undefined) ?? null,
		google_place_id: hit.restaurant.google_place_id,
		match_field: hit.field,
		match_snippet: hit.snippet
	}));
	const knownIds = new Set(vault.map((v) => v.google_place_id).filter(Boolean));

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

	return json({
		vault,
		google,
		google_enabled: hasGoogleKey()
	});
};

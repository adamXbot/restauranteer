import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bboxAround, haversineMeters } from '$lib/geo';
import { cuisinesFromTypes } from '$lib/cuisine';
import { findRestaurantsInBox, findByGooglePlaceId } from '$lib/server/db/queries';
import { hasGoogleKey, nearbySearch } from '$lib/server/providers/google';
import { log } from '$lib/server/log';

const MAX_RADIUS_M = 25_000;

export type NearVaultResult = {
	source: 'vault';
	uuid: string;
	name: string;
	address: string | null;
	suburb: string | null;
	lat: number;
	lng: number;
	distance_m: number;
	rating: number | null;
	cuisine: string[];
	tags: string[];
	lists: string[];
};

export type NearGoogleResult = {
	source: 'google';
	place_id: string;
	name: string;
	address: string | null;
	lat: number;
	lng: number;
	distance_m: number;
	rating: number | null;
	user_rating_count: number | null;
	cuisine: string[];
	price_level: number | null;
	photo_name: string | null;
};

export const GET: RequestHandler = async ({ url }) => {
	const latStr = url.searchParams.get('lat');
	const lngStr = url.searchParams.get('lng');
	if (latStr == null || lngStr == null) throw error(400, 'lat and lng required');
	const lat = Number(latStr);
	const lng = Number(lngStr);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw error(400, 'invalid lat/lng');
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
		throw error(400, 'lat/lng out of range');
	}
	let radius = Number(url.searchParams.get('radius') ?? '2000');
	if (!Number.isFinite(radius) || radius <= 0) radius = 2000;
	radius = Math.min(radius, MAX_RADIUS_M);

	const source = (url.searchParams.get('source') ?? 'all').toLowerCase();
	const includeGoogle = source !== 'vault' && hasGoogleKey();
	const minRatingRaw = url.searchParams.get('min_rating');
	const minRating =
		minRatingRaw && Number.isFinite(Number(minRatingRaw)) ? Number(minRatingRaw) : undefined;
	const cuisinesParam = url.searchParams.get('cuisines');
	const cuisines = cuisinesParam ? cuisinesParam.split(',').filter(Boolean) : undefined;
	const forceRefresh = url.searchParams.get('refresh') === '1';

	const bbox = bboxAround(lat, lng, radius);

	const vaultCandidates = findRestaurantsInBox({
		...bbox,
		minRating,
		cuisines
	});
	const vault: NearVaultResult[] = vaultCandidates
		.filter((r) => r.lat != null && r.lng != null)
		.map((r) => ({
			source: 'vault' as const,
			uuid: r.uuid,
			name: r.name,
			address: (r.frontmatter.address as string | undefined) ?? null,
			suburb: (r.frontmatter.suburb as string | undefined) ?? null,
			lat: r.lat!,
			lng: r.lng!,
			distance_m: haversineMeters(lat, lng, r.lat!, r.lng!),
			rating: typeof r.frontmatter.rating === 'number' ? r.frontmatter.rating : null,
			cuisine: (r.frontmatter.cuisine as string[] | undefined) ?? [],
			tags: r.tags,
			lists: r.lists
		}))
		.filter((r) => r.distance_m <= radius)
		.sort((a, b) => a.distance_m - b.distance_m);

	let google: NearGoogleResult[] = [];
	if (includeGoogle) {
		try {
			const found = await nearbySearch(lat, lng, radius, { forceRefresh });
			const vaultPlaceIds = new Set(
				vaultCandidates
					.map((r) => r.google_place_id)
					.filter((x): x is string => typeof x === 'string')
			);
			google = found
				.filter((g) => g.place_id && !vaultPlaceIds.has(g.place_id))
				.filter((g) => !minRating || (g.rating ?? 0) >= minRating)
				.map((g) => {
					const inferredCuisines = cuisinesFromTypes(g.types);
					return {
						source: 'google' as const,
						place_id: g.place_id,
						name: g.name,
						address: g.address,
						lat: g.lat,
						lng: g.lng,
						distance_m: haversineMeters(lat, lng, g.lat, g.lng),
						rating: g.rating,
						user_rating_count: g.user_rating_count,
						cuisine: inferredCuisines,
						price_level: g.price_level,
						photo_name: g.photo_name
					};
				})
				.filter((g) => {
					if (!cuisines || cuisines.length === 0) return true;
					const want = cuisines.map((c) => c.toLowerCase());
					return g.cuisine.some((c) => want.includes(c.toLowerCase()));
				})
				.filter((g) => g.distance_m <= radius)
				.sort((a, b) => a.distance_m - b.distance_m);
		} catch (e) {
			log.error('Near search Google failed', { error: String(e) });
		}
	}

	// Final ordering: interleave by distance.
	const combined = [...vault, ...google].sort((a, b) => a.distance_m - b.distance_m);

	return json({
		center: { lat, lng },
		radius_m: radius,
		google_enabled: hasGoogleKey(),
		vault_count: vault.length,
		google_count: google.length,
		results: combined
	});
};

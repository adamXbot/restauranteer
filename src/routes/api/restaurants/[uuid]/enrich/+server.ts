import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { hasGoogleKey, searchPlacesByText } from '$lib/server/providers/google';
import { mergeGooglePlaceIntoRestaurant } from '$lib/server/vault/create';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ params, url }) => {
	if (!hasGoogleKey()) throw error(503, 'Google Places API key is not configured');

	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');

	const fm = indexed.frontmatter as Record<string, unknown>;
	const name = (fm.name as string | undefined) ?? indexed.name;
	const suburb = (fm.suburb as string | undefined) ?? '';
	const address = (fm.address as string | undefined) ?? '';

	const override = url.searchParams.get('q')?.trim();
	const query =
		override ||
		[name, suburb || address.split(',')[1]?.trim() || '', 'Australia']
			.filter((s) => s && s.length > 0)
			.join(' ');

	const lat = typeof indexed.lat === 'number' ? indexed.lat : undefined;
	const lng = typeof indexed.lng === 'number' ? indexed.lng : undefined;

	try {
		const candidates = await searchPlacesByText(query, {
			lat,
			lng,
			radiusMeters: lat != null && lng != null ? 5_000 : undefined,
			maxResults: 8
		});
		return json({ query, candidates });
	} catch (e) {
		log.error('Enrich search failed', { error: String(e), uuid: params.uuid, query });
		throw error(502, 'Google Places search failed');
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	if (!hasGoogleKey()) throw error(503, 'Google Places API key is not configured');

	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');

	const body = (await request.json().catch(() => null)) as { place_id?: string } | null;
	const placeId = body?.place_id?.trim();
	if (!placeId) throw error(400, 'place_id is required');

	try {
		const result = await mergeGooglePlaceIntoRestaurant(params.uuid, placeId);
		return json({ ok: true, merged_fields: result.merged_fields });
	} catch (e) {
		log.error('Enrich merge failed', { error: String(e), uuid: params.uuid, placeId });
		throw error(502, 'Failed to merge Google place data');
	}
};

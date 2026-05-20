import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hasGoogleKey, placeDetails } from '$lib/server/providers/google';
import { findByGooglePlaceId } from '$lib/server/db/queries';

export const GET: RequestHandler = async ({ params, url }) => {
	if (!hasGoogleKey()) throw error(503, 'Google Places not configured');
	const forceRefresh = url.searchParams.get('refresh') === '1';
	try {
		const details = await placeDetails(params.id, { forceRefresh });
		const existing = findByGooglePlaceId(params.id);
		return json({
			place: details,
			vault_uuid: existing?.uuid ?? null
		});
	} catch (e) {
		throw error(502, String(e));
	}
};

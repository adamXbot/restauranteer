import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasGoogleKey, placeDetails } from '$lib/server/providers/google';
import { findByGooglePlaceId } from '$lib/server/db/queries';
import { getPreferences } from '$lib/server/preferences';

export const load: PageServerLoad = async ({ params }) => {
	if (!hasGoogleKey()) throw error(503, 'Google Places not configured');
	try {
		const place = await placeDetails(params.id);
		const existing = findByGooglePlaceId(params.id);
		return {
			place,
			vaultUuid: existing?.uuid ?? null,
			preferences: getPreferences()
		};
	} catch (e) {
		throw error(502, `Failed to fetch place: ${String(e)}`);
	}
};

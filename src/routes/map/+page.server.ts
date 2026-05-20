import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { getPreferences } from '$lib/server/preferences';
import { hasAppleMapKit } from '$lib/server/providers/apple';

export const load: PageServerLoad = () => {
	return {
		mapboxToken: env.MAPBOX_PUBLIC_TOKEN ?? '',
		googleMapsKey: env.GOOGLE_MAPS_PUBLIC_KEY ?? '',
		appleAvailable: hasAppleMapKit(),
		preferences: getPreferences()
	};
};

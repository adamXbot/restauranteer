import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { adapters } from '$lib/server/providers/scraper/registry';
import { getPreferences } from '$lib/server/preferences';
import { hasGoogleKey } from '$lib/server/providers/google';
import { hasAppleMapKit } from '$lib/server/providers/apple';

export const load: PageServerLoad = () => {
	const prefs = getPreferences();
	return {
		mapboxToken: env.MAPBOX_PUBLIC_TOKEN ?? '',
		googleMapsKey: env.GOOGLE_MAPS_PUBLIC_KEY ?? '',
		googleEnabled: hasGoogleKey(),
		appleAvailable: hasAppleMapKit(),
		preferences: prefs,
		sources: adapters.map((a) => ({
			id: a.id,
			label: a.label,
			cities: a.cities,
			suburbBrowsable: a.suburbBrowsable,
			cityBrowsable: a.cityBrowsable
		})),
		australianCentric: prefs.australian_centric
	};
};

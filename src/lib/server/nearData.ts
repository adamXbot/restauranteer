import { env } from '$env/dynamic/private';
import { getDistinctCuisines } from '$lib/server/db/queries';
import { hasGoogleKey } from '$lib/server/providers/google';
import { hasAppleMapKit } from '$lib/server/providers/apple';
import { getPreferences } from '$lib/server/preferences';

const COMMON_GOOGLE_CUISINES = [
	'Italian',
	'French',
	'Japanese',
	'Chinese',
	'Korean',
	'Vietnamese',
	'Thai',
	'Indian',
	'Mexican',
	'Mediterranean',
	'Greek',
	'American',
	'Steakhouse',
	'Seafood',
	'Sushi',
	'Ramen',
	'Pizza',
	'Burgers',
	'Vegan',
	'Vegetarian',
	'Café',
	'Bakery',
	'Bar',
	'Wine bar',
	'Pub',
	'Dessert',
	'Ice cream'
];

/**
 * Everything the shared NearMap component needs (map keys, provider availability,
 * preferences, and the cuisine list for the picker). Used by both /near and the
 * map-led section of /discover.
 */
export function nearMapData() {
	const vaultCuisines = getDistinctCuisines();
	const combined = Array.from(new Set([...vaultCuisines, ...COMMON_GOOGLE_CUISINES])).sort((a, b) =>
		a.localeCompare(b)
	);
	return {
		mapboxToken: env.MAPBOX_PUBLIC_TOKEN ?? '',
		googleMapsKey: env.GOOGLE_MAPS_PUBLIC_KEY ?? '',
		googleEnabled: hasGoogleKey(),
		appleAvailable: hasAppleMapKit(),
		preferences: getPreferences(),
		cuisines: combined
	};
}

/// <reference types="google.maps" />
/**
 * Lazy-loads the Google Maps JavaScript API from googleapis.com and caches
 * the load promise so /map and /near can both call it cheaply.
 */

declare global {
	interface Window {
		google?: typeof google;
	}
}

let loadPromise: Promise<typeof google> | null = null;
let loadedWithKey: string | null = null;

export async function loadGoogleMaps(key: string): Promise<typeof google> {
	if (typeof window === 'undefined') throw new Error('Google Maps only available in browser');
	if (!key) throw new Error('GOOGLE_MAPS_PUBLIC_KEY is not configured');
	if (window.google?.maps && loadedWithKey === key) return window.google;
	if (loadPromise && loadedWithKey === key) return loadPromise;
	loadedWithKey = key;
	loadPromise = new Promise((resolve, reject) => {
		const params = new URLSearchParams({
			key,
			v: 'weekly',
			libraries: 'marker'
		});
		const script = document.createElement('script');
		script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
		script.async = true;
		script.onload = () => {
			if (window.google?.maps) resolve(window.google);
			else reject(new Error('Google Maps loaded but globals not set'));
		};
		script.onerror = () => reject(new Error('Google Maps JS failed to load'));
		document.head.appendChild(script);
	});
	return loadPromise;
}

/** Minimal dark theme so the map matches the slate palette. */
export const GOOGLE_DARK_STYLES = [
	{ elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
	{ elementType: 'labels.text.stroke', stylers: [{ color: '#0f172a' }] },
	{ elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
	{
		featureType: 'administrative.land_parcel',
		stylers: [{ visibility: 'off' }]
	},
	{
		featureType: 'administrative.neighborhood',
		stylers: [{ visibility: 'off' }]
	},
	{
		featureType: 'poi',
		elementType: 'labels.text',
		stylers: [{ visibility: 'off' }]
	},
	{
		featureType: 'poi.business',
		stylers: [{ visibility: 'off' }]
	},
	{
		featureType: 'poi.park',
		elementType: 'geometry',
		stylers: [{ color: '#1e293b' }]
	},
	{
		featureType: 'road',
		elementType: 'geometry',
		stylers: [{ color: '#1e293b' }]
	},
	{
		featureType: 'road',
		elementType: 'geometry.stroke',
		stylers: [{ color: '#0f172a' }]
	},
	{
		featureType: 'road',
		elementType: 'labels.text.fill',
		stylers: [{ color: '#64748b' }]
	},
	{
		featureType: 'road.highway',
		elementType: 'geometry',
		stylers: [{ color: '#334155' }]
	},
	{
		featureType: 'transit',
		elementType: 'geometry',
		stylers: [{ color: '#1e293b' }]
	},
	{
		featureType: 'water',
		elementType: 'geometry',
		stylers: [{ color: '#020617' }]
	},
	{
		featureType: 'water',
		elementType: 'labels.text.fill',
		stylers: [{ color: '#475569' }]
	}
];

/**
 * Geographic helpers usable on both server and client.
 */

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number
): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return EARTH_RADIUS_M * c;
}

/**
 * Approximate bounding box at a given lat/lng + radius (meters). Returned as
 * [minLat, maxLat, minLng, maxLng]. Pre-filter SQL with this, then refine via
 * haversine for exact distances.
 */
export function bboxAround(
	lat: number,
	lng: number,
	radiusMeters: number
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
	const latDelta = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
	const lngDelta =
		((radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI)) /
		Math.max(Math.cos((lat * Math.PI) / 180), 0.000_001);
	return {
		minLat: lat - latDelta,
		maxLat: lat + latDelta,
		minLng: lng - lngDelta,
		maxLng: lng + lngDelta
	};
}

export function formatDistance(meters: number): string {
	if (meters < 1000) return `${Math.round(meters)}m`;
	if (meters < 10_000) return `${(meters / 1000).toFixed(1)}km`;
	return `${Math.round(meters / 1000)}km`;
}

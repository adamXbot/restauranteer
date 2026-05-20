export type NavigationApp = 'apple' | 'google';

export type NavigationTarget = {
	name?: string | null;
	address?: string | null;
	lat?: number | null;
	lng?: number | null;
};

/**
 * Build a "directions to here" URL for the user's chosen maps app. The URL
 * opens the native app on iOS / Android when installed; otherwise it falls
 * back to the web map.
 */
export function navigationUrl(target: NavigationTarget, app: NavigationApp): string | null {
	const haveCoords = typeof target.lat === 'number' && typeof target.lng === 'number';
	const haveAddress = !!(target.address && target.address.trim().length > 0);
	if (!haveCoords && !haveAddress) return null;

	const coordsStr = haveCoords ? `${target.lat},${target.lng}` : '';
	const queryStr = haveAddress ? target.address!.trim() : target.name?.trim() ?? '';

	if (app === 'apple') {
		// Apple Maps. Prefer coords for precision; daddr is the destination.
		const params = new URLSearchParams();
		if (haveCoords) params.set('daddr', coordsStr);
		else if (queryStr) params.set('daddr', queryStr);
		params.set('dirflg', 'd'); // driving
		return `https://maps.apple.com/?${params.toString()}`;
	}

	// Google Maps universal directions URL
	const params = new URLSearchParams({ api: '1' });
	params.set('destination', haveCoords ? coordsStr : queryStr);
	return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function labelForApp(app: NavigationApp): string {
	return app === 'apple' ? 'Apple Maps' : 'Google Maps';
}

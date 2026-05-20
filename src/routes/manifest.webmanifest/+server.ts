import type { RequestHandler } from './$types';
import {
	buildWebManifest,
	manifestBrightnessFromSearchParams,
	themePreferencesFromSearchParams
} from '$lib/manifest';

export const GET: RequestHandler = ({ url }) => {
	const preferences = themePreferencesFromSearchParams(url.searchParams);
	const brightness = manifestBrightnessFromSearchParams(url.searchParams, preferences);
	return new Response(JSON.stringify(buildWebManifest(preferences, brightness)), {
		headers: {
			'content-type': 'application/manifest+json',
			'cache-control': 'no-cache'
		}
	});
};

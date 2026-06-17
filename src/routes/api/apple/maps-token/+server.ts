import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMapKitToken, hasAppleMapKit } from '$lib/server/providers/apple';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ request, url }) => {
	if (!hasAppleMapKit()) {
		throw error(503, 'Apple MapKit not configured (set APPLE_MAPKIT_* in .env)');
	}
	try {
		// Same-origin GETs usually omit the Origin header, so fall back to the
		// Referer (the page URL) and finally the request URL's origin. Overridden
		// by APPLE_MAPKIT_ORIGIN inside getMapKitToken when set.
		const requestOrigin =
			request.headers.get('origin') ?? refererOrigin(request.headers.get('referer')) ?? url.origin;
		const token = await getMapKitToken(requestOrigin);
		// Apple's mapkit.init authorizationCallback wants the raw JWT string
		return new Response(token, {
			headers: {
				'Content-Type': 'text/plain',
				'Cache-Control': 'private, max-age=900'
			}
		});
	} catch (e) {
		log.error('MapKit token endpoint failed', { error: String(e) });
		throw error(500, String(e));
	}
};

function refererOrigin(referer: string | null): string | undefined {
	if (!referer) return undefined;
	try {
		return new URL(referer).origin;
	} catch {
		return undefined;
	}
}

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMapKitToken, hasAppleMapKit } from '$lib/server/providers/apple';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async () => {
	if (!hasAppleMapKit()) {
		throw error(503, 'Apple MapKit not configured (set APPLE_MAPKIT_* in .env)');
	}
	try {
		const token = await getMapKitToken();
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

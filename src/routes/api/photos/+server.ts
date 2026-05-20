import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchPhoto, hasGoogleKey } from '$lib/server/providers/google';

export const GET: RequestHandler = async ({ url }) => {
	if (!hasGoogleKey()) throw error(503, 'Google Places not configured');
	const name = url.searchParams.get('name');
	const width = Number(url.searchParams.get('w') ?? '800');
	if (!name) throw error(400, 'name required');
	// Defensive: only accept photo names in the expected Google form
	if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) {
		throw error(400, 'invalid photo name');
	}

	try {
		const { body, contentType } = await fetchPhoto(name, Number.isFinite(width) ? width : 800);
		if (!body) throw error(502, 'no body');
		return new Response(body, {
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=86400, immutable'
			}
		});
	} catch (e) {
		throw error(502, String(e));
	}
};

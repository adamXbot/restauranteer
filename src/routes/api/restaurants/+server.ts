import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllRestaurants } from '$lib/server/db/queries';
import { createRestaurantFromApplePlace, createRestaurantFromGooglePlace } from '$lib/server/vault/create';

export const GET: RequestHandler = () => {
	const list = getAllRestaurants();
	return json({ count: list.length, restaurants: list });
};

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON');
	}
	if (!body || typeof body !== 'object') throw error(400, 'body must be an object');
	const fields = body as Record<string, unknown>;

	// Apple-sourced create: the search lane returns a place rather than an id
	// we can re-fetch, so the fields travel with the request. Apple exposes
	// no price level or rating, which is why these entries are the natural
	// candidates for a one-tap Google enrich afterwards.
	if (fields.source === 'apple') {
		const name = typeof fields.name === 'string' ? fields.name : '';
		if (!name.trim()) throw error(400, 'name required');
		const result = await createRestaurantFromApplePlace({
			name,
			address: typeof fields.address === 'string' ? fields.address : null,
			lat: typeof fields.lat === 'number' ? fields.lat : null,
			lng: typeof fields.lng === 'number' ? fields.lng : null,
			place_id: typeof fields.place_id === 'string' ? fields.place_id : null
		});
		return json(result, { status: result.alreadyExisted ? 200 : 201 });
	}

	const placeId = fields.google_place_id;
	if (typeof placeId !== 'string' || placeId.length === 0) {
		throw error(400, 'google_place_id required');
	}
	const result = await createRestaurantFromGooglePlace(placeId);
	return json(result, { status: result.alreadyExisted ? 200 : 201 });
};

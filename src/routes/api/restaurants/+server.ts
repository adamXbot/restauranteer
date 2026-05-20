import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllRestaurants } from '$lib/server/db/queries';
import { createRestaurantFromGooglePlace } from '$lib/server/vault/create';

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
	const placeId = (body as Record<string, unknown>).google_place_id;
	if (typeof placeId !== 'string' || placeId.length === 0) {
		throw error(400, 'google_place_id required');
	}
	const result = await createRestaurantFromGooglePlace(placeId);
	return json(result, { status: result.alreadyExisted ? 200 : 201 });
};

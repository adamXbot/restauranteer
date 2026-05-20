import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { attachInboxToRestaurant, getInboxItem } from '$lib/server/inbox';
import { createBlankRestaurant } from '$lib/server/vault/create';

type Body = {
	name?: unknown;
	suburb?: unknown;
	address?: unknown;
	cuisine?: unknown;
};

export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const item = getInboxItem(id);
	if (!item) throw error(404, 'inbox item not found');

	const body = (await request.json().catch(() => null)) as Body | null;
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	if (!name) throw error(400, 'name required');
	const suburb = typeof body?.suburb === 'string' ? body.suburb : null;
	const address = typeof body?.address === 'string' ? body.address : null;
	const cuisine = Array.isArray(body?.cuisine)
		? body.cuisine.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
		: [];

	try {
		const created = await createBlankRestaurant({ name, suburb, address, cuisine });
		await attachInboxToRestaurant(id, created.uuid);
		return json({ uuid: created.uuid, filePath: created.filePath });
	} catch (e) {
		throw error(500, String(e instanceof Error ? e.message : e));
	}
};

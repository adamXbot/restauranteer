import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { attachInboxToRestaurant } from '$lib/server/inbox';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const body = (await request.json().catch(() => null)) as { uuid?: unknown } | null;
	if (!body || typeof body.uuid !== 'string' || body.uuid.length === 0) {
		throw error(400, 'uuid required');
	}
	try {
		const result = await attachInboxToRestaurant(id, body.uuid);
		return json(result);
	} catch (e) {
		throw error(500, String(e instanceof Error ? e.message : e));
	}
};

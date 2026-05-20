import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { renameRestaurant } from '$lib/server/vault/rename';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
	if (!body || typeof body.name !== 'string') throw error(400, 'name (string) required');

	try {
		const result = await renameRestaurant(params.uuid, body.name);
		return json(result);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		log.error('Rename failed', { uuid: params.uuid, error: msg });
		if (/not found/i.test(msg)) throw error(404, msg);
		if (/empty|too long/i.test(msg)) throw error(400, msg);
		throw error(500, msg);
	}
};

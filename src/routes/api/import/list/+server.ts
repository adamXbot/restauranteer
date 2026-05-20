import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importGoogleList } from '$lib/server/vault/importGoogleList';
import { regenerateAllMocs } from '$lib/server/vault/moc';
import { log } from '$lib/server/log';

type Body = {
	list_name?: unknown;
	notes?: unknown;
	icon?: unknown;
	source_url?: unknown;
	place_ids?: unknown;
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Body | null;
	if (!body) throw error(400, 'invalid JSON');
	const listName = typeof body.list_name === 'string' ? body.list_name.trim() : '';
	if (!listName) throw error(400, 'list_name required');
	if (!Array.isArray(body.place_ids)) throw error(400, 'place_ids must be an array');
	const placeIds = body.place_ids.filter(
		(id): id is string => typeof id === 'string' && id.length > 0
	);

	try {
		const result = await importGoogleList({
			list_name: listName,
			notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
			icon: typeof body.icon === 'string' ? body.icon.trim() || null : null,
			source_url: typeof body.source_url === 'string' ? body.source_url || null : null,
			place_ids: placeIds
		});
		try {
			await regenerateAllMocs();
		} catch (e) {
			log.error('MOC regen after list import failed', { error: String(e) });
		}
		return json(result);
	} catch (e) {
		log.error('Google list import failed', { error: String(e) });
		throw error(500, String(e instanceof Error ? e.message : e));
	}
};

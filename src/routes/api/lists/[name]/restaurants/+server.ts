import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addRestaurantToList } from '$lib/server/vault/importGoogleList';

const MAX_LIST_NOTE_LEN = 1000;

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as {
		uuid?: unknown;
		note?: unknown;
	} | null;
	if (!body || typeof body.uuid !== 'string' || body.uuid.trim().length === 0) {
		throw error(400, 'uuid required');
	}
	const note = typeof body.note === 'string' ? body.note.trim() : undefined;
	if (note && note.length > MAX_LIST_NOTE_LEN) {
		throw error(400, `list note too long (max ${MAX_LIST_NOTE_LEN})`);
	}
	try {
		await addRestaurantToList(body.uuid.trim(), params.name, note);
		return json({ ok: true });
	} catch (e) {
		throw error(400, String(e instanceof Error ? e.message : e));
	}
};

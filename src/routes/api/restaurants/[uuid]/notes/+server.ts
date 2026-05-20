import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import { saveRestaurant } from '$lib/server/vault/save';
import { extractRestaurantNotes, updateRestaurantNotes } from '$lib/server/vault/notes';

const MAX_NOTES_LEN = 20_000;

export const POST: RequestHandler = async ({ params, request }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');

	const body = (await request.json().catch(() => null)) as { notes?: unknown } | null;
	if (!body) throw error(400, 'invalid JSON');
	if (typeof body.notes !== 'string') throw error(400, 'notes must be a string');
	if (body.notes.length > MAX_NOTES_LEN) {
		throw error(400, `notes too long (max ${MAX_NOTES_LEN})`);
	}

	const rf = await readRestaurant(indexed.file_path);
	const nextBody = updateRestaurantNotes(rf.body, body.notes);
	await saveRestaurant(indexed.file_path, rf.frontmatter, nextBody);

	return json({ notes: extractRestaurantNotes(nextBody) });
};

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import { saveRestaurant } from '$lib/server/vault/save';
import { coerceAttributeAnswers } from '$lib/attributes';

export const POST: RequestHandler = async ({ params, request }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');

	const body = (await request.json().catch(() => null)) as { attributes?: unknown } | null;
	if (!body) throw error(400, 'invalid JSON');
	const answers = coerceAttributeAnswers(body.attributes);

	const rf = await readRestaurant(indexed.file_path);
	const newFm = { ...rf.frontmatter };
	if (Object.keys(answers).length > 0) {
		newFm.attributes = answers;
	} else {
		delete newFm.attributes;
	}
	await saveRestaurant(indexed.file_path, newFm, rf.body);

	return json({ attributes: answers });
};

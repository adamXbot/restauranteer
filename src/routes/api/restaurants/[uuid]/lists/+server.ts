import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import { saveRestaurant } from '$lib/server/vault/save';

const MAX_LIST_NAME_LEN = 60;
const MAX_LISTS_PER_RESTAURANT = 50;

function normalizeLists(input: unknown): string[] {
	if (!Array.isArray(input)) throw error(400, 'lists must be an array of strings');
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of input) {
		if (typeof raw !== 'string') throw error(400, 'lists entries must be strings');
		const trimmed = raw.trim();
		if (trimmed.length === 0) continue;
		if (trimmed.length > MAX_LIST_NAME_LEN) {
			throw error(400, `list name too long (max ${MAX_LIST_NAME_LEN})`);
		}
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}
	if (out.length > MAX_LISTS_PER_RESTAURANT) {
		throw error(400, `too many lists (max ${MAX_LISTS_PER_RESTAURANT})`);
	}
	return out;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');

	const body = (await request.json().catch(() => null)) as { lists?: unknown } | null;
	if (!body) throw error(400, 'invalid JSON');
	const newLists = normalizeLists(body.lists);

	const rf = await readRestaurant(indexed.file_path);
	const previousLists = Array.isArray(rf.frontmatter.lists)
		? (rf.frontmatter.lists as string[])
		: [];
	const affected = Array.from(new Set([...previousLists, ...newLists]));

	const newFm = { ...rf.frontmatter, lists: newLists };
	await saveRestaurant(indexed.file_path, newFm, rf.body, { affectedLists: affected });

	return json({ lists: newLists });
};

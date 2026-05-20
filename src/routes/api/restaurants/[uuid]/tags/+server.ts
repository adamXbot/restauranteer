import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import { saveRestaurant } from '$lib/server/vault/save';

const MAX_TAG_LEN = 40;
const MAX_TAGS = 100;

function normalizeTags(input: unknown): string[] {
	if (!Array.isArray(input)) throw error(400, 'tags must be an array of strings');
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of input) {
		if (typeof raw !== 'string') throw error(400, 'tag entries must be strings');
		const trimmed = raw.trim().replace(/^#/, '');
		if (trimmed.length === 0) continue;
		if (trimmed.length > MAX_TAG_LEN) throw error(400, `tag too long (max ${MAX_TAG_LEN})`);
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}
	if (out.length > MAX_TAGS) throw error(400, `too many tags (max ${MAX_TAGS})`);
	return out;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');

	const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
	if (!body) throw error(400, 'invalid JSON');
	const newTags = normalizeTags(body.tags);

	const rf = await readRestaurant(indexed.file_path);
	const newFm = { ...rf.frontmatter, tags: newTags };
	await saveRestaurant(indexed.file_path, newFm, rf.body);

	return json({ tags: newTags });
};

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addToInbox, listInbox, suggestionsForTitle } from '$lib/server/inbox';

export const GET: RequestHandler = () => {
	const items = listInbox();
	return json({
		items: items.map((i) => ({
			...i,
			suggestions: suggestionsForTitle(i.title)
		}))
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
	if (!body || typeof body.url !== 'string') throw error(400, 'url required');
	try {
		const result = await addToInbox(body.url);
		return json(result);
	} catch (e) {
		throw error(400, String(e instanceof Error ? e.message : e));
	}
};

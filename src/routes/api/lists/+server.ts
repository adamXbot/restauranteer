import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createEmptyListMoc, getAllListSummaries } from '$lib/server/vault/moc';
import { LIST_NAME_REJECTION_MESSAGE, validateListName } from '$lib/server/vault/listName';

function normalizeListName(input: unknown): string {
	if (typeof input !== 'string') throw error(400, 'name required');
	const verdict = validateListName(input);
	if (!verdict.ok) {
		throw error(400, verdict.reason === 'empty' ? 'name required'
			: LIST_NAME_REJECTION_MESSAGE[verdict.reason]);
	}
	return verdict.name;
}

export const GET: RequestHandler = async () => {
	return json({ lists: await getAllListSummaries() });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
	if (!body) throw error(400, 'invalid JSON');
	const name = normalizeListName(body.name);
	const existing = (await getAllListSummaries()).find(
		(l) => l.name.toLowerCase() === name.toLowerCase()
	);
	if (existing) return json({ name: existing.name, created: false });

	await createEmptyListMoc(name);
	return json({ name, created: true }, { status: 201 });
};

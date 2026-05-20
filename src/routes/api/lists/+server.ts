import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createEmptyListMoc, getAllListSummaries } from '$lib/server/vault/moc';

const MAX_LIST_NAME_LEN = 60;

function normalizeListName(input: unknown): string {
	if (typeof input !== 'string') throw error(400, 'name required');
	const name = input.trim();
	if (!name) throw error(400, 'name required');
	if (name.length > MAX_LIST_NAME_LEN) {
		throw error(400, `list name too long (max ${MAX_LIST_NAME_LEN})`);
	}
	if (name === '.' || name === '..' || name.startsWith('.')) {
		throw error(400, 'list name cannot start with "."');
	}
	if (/[/\\\0\r\n]/.test(name)) {
		throw error(400, 'list name cannot include slashes or line breaks');
	}
	return name;
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

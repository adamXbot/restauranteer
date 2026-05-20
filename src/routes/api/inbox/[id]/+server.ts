import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dismissInbox } from '$lib/server/inbox';

export const DELETE: RequestHandler = ({ params }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const removed = dismissInbox(id);
	return json({ removed });
};

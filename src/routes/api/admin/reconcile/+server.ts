import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fullReconcile } from '$lib/server/vault/reconciler';
import { regenerateAllMocs } from '$lib/server/vault/moc';

export const POST: RequestHandler = async () => {
	const result = await fullReconcile();
	await regenerateAllMocs();
	return json(result);
};

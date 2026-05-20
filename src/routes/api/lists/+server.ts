import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDistinctLists } from '$lib/server/db/queries';

export const GET: RequestHandler = () => {
	return json({ lists: getDistinctLists() });
};

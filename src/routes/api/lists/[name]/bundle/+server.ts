import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildListBundle } from '$lib/server/vault/share';
import { getRestaurantNamesForList } from '$lib/server/db/queries';

export const GET: RequestHandler = async ({ params }) => {
	const name = params.name;
	if (!name) throw error(400, 'list name required');
	if (getRestaurantNamesForList(name).length === 0) {
		throw error(404, `List "${name}" is empty or does not exist`);
	}
	const bundle = await buildListBundle(name);
	return new Response(bundle, {
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.md"`
		}
	});
};

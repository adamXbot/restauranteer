import type { PageServerLoad } from './$types';
import { getAllListSummaries } from '$lib/server/vault/moc';

export const load: PageServerLoad = async ({ url }) => {
	return {
		lists: await getAllListSummaries(),
		create: url.searchParams.get('new') === '1'
	};
};

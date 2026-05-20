import type { PageServerLoad } from './$types';
import { getDistinctLists } from '$lib/server/db/queries';

export const load: PageServerLoad = () => {
	return { lists: getDistinctLists() };
};

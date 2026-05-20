import type { PageServerLoad } from './$types';
import { getAllListSummaries } from '$lib/server/vault/moc';

export const load: PageServerLoad = async () => {
	return { lists: await getAllListSummaries() };
};

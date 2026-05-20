import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { getPreferences } from '$lib/server/preferences';

export const load: PageServerLoad = ({ params }) => {
	const r = getRestaurantByUuid(params.uuid);
	if (!r) throw error(404, 'Restaurant not found');
	return { uuid: r.uuid, name: r.name, preferences: getPreferences() };
};

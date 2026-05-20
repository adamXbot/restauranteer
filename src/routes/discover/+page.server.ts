import type { PageServerLoad } from './$types';
import { adapters } from '$lib/server/providers/scraper/registry';
import { getPreferences } from '$lib/server/preferences';

export const load: PageServerLoad = () => {
	const prefs = getPreferences();
	return {
		sources: adapters.map((a) => ({
			id: a.id,
			label: a.label,
			cities: a.cities,
			suburbBrowsable: a.suburbBrowsable,
			cityBrowsable: a.cityBrowsable
		})),
		australianCentric: prefs.australian_centric
	};
};

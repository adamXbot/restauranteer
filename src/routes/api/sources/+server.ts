import { json } from '@sveltejs/kit';
import { adapters } from '$lib/server/providers/scraper/registry';

export const GET = () => {
	return json({
		sources: adapters.map((a) => ({
			id: a.id,
			label: a.label,
			cities: a.cities,
			suburbBrowsable: a.suburbBrowsable
		}))
	});
};

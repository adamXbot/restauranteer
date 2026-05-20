import type { PageServerLoad } from './$types';
import { getAllRestaurants } from '$lib/server/db/queries';
import { getPreferences } from '$lib/server/preferences';

export const load: PageServerLoad = () => {
	const restaurants = getAllRestaurants().map((r) => ({
		uuid: r.uuid,
		name: r.name,
		address: (r.frontmatter.address as string | undefined) ?? null,
		suburb: (r.frontmatter.suburb as string | undefined) ?? null,
		cuisine: (r.frontmatter.cuisine as string[] | undefined) ?? [],
		tags: r.tags,
		lists: r.lists,
		rating: typeof r.frontmatter.rating === 'number' ? r.frontmatter.rating : null,
		visitSummary: r.visitSummary
	}));
	return { restaurants, preferences: getPreferences() };
};

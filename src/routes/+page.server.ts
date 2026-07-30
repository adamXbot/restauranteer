import type { PageServerLoad } from './$types';
import { getAllRestaurants, getAllVisits } from '$lib/server/db/queries';
import { getPreferences } from '$lib/server/preferences';
import type { VisitFeedItem } from '$lib/visitSort';
import { coverPhotoPath } from '$lib/featuredImage';

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
		visitSummary: r.visitSummary,
		// `featured_image` when set, else the newest visit's first photo —
		// resolved here so the card doesn't have to know the rule.
		coverPhoto: coverPhotoPath(r.frontmatter, r.visitSummary)
	}));
	const visits: VisitFeedItem[] = getAllVisits();
	return { restaurants, visits, preferences: getPreferences() };
};

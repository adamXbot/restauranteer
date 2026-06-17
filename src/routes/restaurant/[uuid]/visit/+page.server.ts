import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { getPreferences } from '$lib/server/preferences';
import {
	attributeAppliesTo,
	cleanAnswers,
	type AttributeValue
} from '$lib/attributes';

export const load: PageServerLoad = ({ params }) => {
	const r = getRestaurantByUuid(params.uuid);
	if (!r) throw error(404, 'Restaurant not found');
	const preferences = getPreferences();
	const restaurantCuisines = Array.isArray(r.frontmatter.cuisine)
		? (r.frontmatter.cuisine as string[])
		: [];
	const scopeTarget = { tags: r.tags, cuisines: restaurantCuisines, lists: r.lists };
	const applicableAttributes = preferences.attributes.filter((def) =>
		attributeAppliesTo(def, scopeTarget)
	);
	const restaurantAttributes = cleanAnswers(
		r.frontmatter.attributes as Record<string, AttributeValue> | undefined
	);
	return {
		uuid: r.uuid,
		name: r.name,
		preferences,
		applicableAttributes,
		restaurantAttributes
	};
};

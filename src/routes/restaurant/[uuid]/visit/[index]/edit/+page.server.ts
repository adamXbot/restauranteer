import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import {
	parseVisitFields,
	parseVisits,
	splitBodyAtVisits
} from '$lib/server/vault/visit';
import { getPreferences } from '$lib/server/preferences';
import {
	attributeAppliesTo,
	cleanAnswers,
	type AttributeValue
} from '$lib/attributes';

export const load: PageServerLoad = async ({ params }) => {
	const r = getRestaurantByUuid(params.uuid);
	if (!r) throw error(404, 'Restaurant not found');

	const idx = Number.parseInt(params.index, 10);
	if (!Number.isFinite(idx) || idx < 0) throw error(400, 'Invalid visit index');

	const file = await readRestaurant(r.file_path);
	const split = splitBodyAtVisits(file.body);
	const visits = parseVisits(split.visitsSection);
	const visit = visits[idx];
	if (!visit) throw error(404, 'Visit not found');

	const fields = parseVisitFields(visit);

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
		index: idx,
		fields,
		headline: visit.headline,
		preferences,
		applicableAttributes,
		restaurantAttributes
	};
};

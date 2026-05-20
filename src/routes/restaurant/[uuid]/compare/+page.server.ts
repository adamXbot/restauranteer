import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { gatherComparison } from '$lib/server/compare';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const comparison = await gatherComparison(params.uuid);
		return comparison;
	} catch (e) {
		const msg = String(e);
		if (msg.includes('not found')) throw error(404, msg);
		throw error(500, msg);
	}
};

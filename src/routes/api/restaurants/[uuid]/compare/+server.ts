import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	applyComparisonSelections,
	gatherComparison,
	COMPARISON_FIELDS,
	type ComparisonField
} from '$lib/server/compare';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const comparison = await gatherComparison(params.uuid);
		return json(comparison);
	} catch (e) {
		const msg = String(e);
		if (msg.includes('not found')) throw error(404, msg);
		log.error('Compare gather failed', { uuid: params.uuid, error: msg });
		throw error(500, msg);
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as {
		selections?: Record<string, string>;
	} | null;
	if (!body?.selections || typeof body.selections !== 'object') {
		throw error(400, 'selections required');
	}
	const safeSelections: Partial<Record<ComparisonField, string>> = {};
	for (const f of COMPARISON_FIELDS) {
		const v = body.selections[f];
		if (typeof v === 'string' && v.length > 0) safeSelections[f] = v;
	}
	try {
		const result = await applyComparisonSelections(params.uuid, safeSelections);
		return json(result);
	} catch (e) {
		const msg = String(e);
		if (msg.includes('not found')) throw error(404, msg);
		log.error('Compare apply failed', { uuid: params.uuid, error: msg });
		throw error(500, msg);
	}
};

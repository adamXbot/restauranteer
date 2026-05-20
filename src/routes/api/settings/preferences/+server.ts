import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPreferences, setPreferences } from '$lib/server/preferences';

export const GET: RequestHandler = () => {
	return json(getPreferences());
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object') throw error(400, 'invalid body');
	const updates: Record<string, unknown> = {};
	if ('per_area_ratings' in body) updates.per_area_ratings = body.per_area_ratings === true;
	if ('default_navigation_app' in body) updates.default_navigation_app = body.default_navigation_app;
	if ('default_map_provider' in body) updates.default_map_provider = body.default_map_provider;
	if ('share_format' in body) updates.share_format = body.share_format;
	if ('australian_centric' in body) updates.australian_centric = body.australian_centric === true;
	if ('show_review_summary' in body) updates.show_review_summary = body.show_review_summary === true;
	if ('theme_mode' in body) updates.theme_mode = body.theme_mode;
	if ('theme_preset' in body) updates.theme_preset = body.theme_preset;
	if ('theme_accent' in body) updates.theme_accent = body.theme_accent;
	const next = setPreferences(updates);
	return json(next);
};

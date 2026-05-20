import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findAdapterForUrl } from '$lib/server/providers/scraper/registry';
import { isGoogleMapsUrl } from '$lib/server/providers/mapsResolver';

/**
 * Tiny lookup used by the unified paste-URL box to decide whether the URL
 * should run through the structured-import flow (`/api/import`) or just be
 * queued in the inbox for later triage.
 */
export const GET: RequestHandler = ({ url }) => {
	const target = url.searchParams.get('url')?.trim() ?? '';
	if (!target || !/^https?:\/\//i.test(target)) {
		return json({ source: null, label: null });
	}

	if (isGoogleMapsUrl(target)) {
		return json({ source: 'google', label: 'Google Maps' });
	}

	const adapter = findAdapterForUrl(target);
	if (adapter) {
		return json({ source: adapter.id, label: adapter.label });
	}

	return json({ source: null, label: null });
};

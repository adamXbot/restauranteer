import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findAdapterForUrl } from '$lib/server/providers/scraper/registry';
import { CACHE_FOREVER, fetchCached } from '$lib/server/providers/cache';
import { findByArticleUrl } from '$lib/server/db/queries';
import { log } from '$lib/server/log';

/** Detect adapter from URL and extract — used for the "paste any URL" flow. */
export const POST: RequestHandler = async ({ request, url }) => {
	const body = (await request.json().catch(() => null)) as {
		url?: string;
		refresh?: boolean;
	} | null;
	if (!body?.url || typeof body.url !== 'string') throw error(400, 'url required');

	const adapter = findAdapterForUrl(body.url);
	if (!adapter) {
		throw error(400, 'URL does not match any supported source (Broadsheet, Good Food)');
	}
	const forceRefresh = body.refresh === true || url.searchParams.get('refresh') === '1';

	try {
		const extracted = await fetchCached(
			`scrape.${adapter.id}.article`,
			body.url,
			CACHE_FOREVER,
			() => adapter.extract(body.url!),
			{ forceRefresh }
		);
		return json({
			source: adapter.id,
			source_label: adapter.label,
			extracted,
			vault_uuid: findByArticleUrl(extracted.url)?.uuid ?? null
		});
	} catch (e) {
		log.error('Auto-extract failed', { url: body.url, error: String(e) });
		throw error(502, `Failed to extract: ${String(e)}`);
	}
};

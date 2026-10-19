import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { immichAssetId } from '$lib/photoRef';
import { fetchImmichAsset, hasImmich } from '$lib/server/providers/immich';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ params, url }) => {
	if (!hasImmich()) throw error(503, 'Immich not configured');
	const id = immichAssetId(`immich:${params.id}`);
	if (!id) throw error(400, 'invalid asset id');
	const size = url.searchParams.get('size') === 'thumbnail' ? 'thumbnail' : 'preview';

	let res;
	try {
		res = await fetchImmichAsset(id, size);
	} catch (e) {
		log.error('Immich fetch failed', { id, error: String(e) });
		throw error(502, 'Immich unreachable');
	}
	// Immich answers a deleted or unshared asset with 400, not 404.
	if (!res.body) {
		throw error(res.status === 400 || res.status === 404 ? 404 : 502, `Immich answered ${res.status}`);
	}
	return new Response(res.body, {
		headers: {
			'Content-Type': res.contentType,
			'Cache-Control': 'private, max-age=86400'
		}
	});
};

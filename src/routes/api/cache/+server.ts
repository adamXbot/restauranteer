import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	cacheStats,
	clearAllCache,
	deleteCachedByProvider
} from '$lib/server/providers/cache';

export const GET: RequestHandler = () => {
	return json(cacheStats());
};

export const DELETE: RequestHandler = ({ url }) => {
	const provider = url.searchParams.get('provider');
	if (provider) {
		const removed = deleteCachedByProvider(provider);
		return json({ cleared: removed, provider });
	}
	if (url.searchParams.get('all') === '1') {
		const removed = clearAllCache();
		return json({ cleared: removed, scope: 'all' });
	}
	throw error(400, 'specify ?provider=... or ?all=1');
};

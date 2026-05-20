import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appVersion, buildInfoFrontmatter } from '$lib/server/vault/share';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/vault/types';

export const GET: RequestHandler = () => {
	return json({
		app: 'restauranteer',
		version: appVersion(),
		schema_version: CURRENT_SCHEMA_VERSION,
		info: buildInfoFrontmatter()
	});
};

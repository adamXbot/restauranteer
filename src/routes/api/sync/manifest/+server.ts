import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildManifest } from '$lib/server/sync/manifest';

/**
 * Full listing of every allowlisted vault file plus the deletion tombstones.
 *
 * v1 always returns everything — 500 restaurants is roughly 60 KB of JSON, and
 * a full compare is cheap next to a wrong incremental one. `?since=<cursor>` is
 * accepted and ignored; it is reserved for a server-side change log later, and
 * a client that sends it still gets a correct (complete) answer.
 */
export const GET: RequestHandler = async () => {
	const manifest = await buildManifest();
	return json(manifest, { headers: { 'Cache-Control': 'no-store' } });
};

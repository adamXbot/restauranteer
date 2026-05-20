import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { restaurantsDir, attachmentsDir } from '$lib/server/config';

export const GET: RequestHandler = async ({ params }) => {
	const rel = params.rest;
	if (!rel || rel.length === 0) throw error(400, 'path required');
	// Defensive: only safe characters
	if (!/^[A-Za-z0-9._\-/]+$/.test(rel)) throw error(400, 'invalid path');
	if (rel.includes('..')) throw error(400, 'invalid path');

	const root = path.resolve(attachmentsDir());
	const candidate = path.resolve(path.join(restaurantsDir(), '_attachments', rel));
	if (!candidate.startsWith(root + path.sep)) throw error(400, 'invalid path');

	let stats;
	try {
		stats = await stat(candidate);
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') throw error(404, 'not found');
		throw error(500, String(err));
	}
	if (!stats.isFile()) throw error(404, 'not found');

	const contentType = mimeFor(candidate);
	const fh = await open(candidate, 'r');
	const stream = fh.createReadStream();
	return new Response(stream as unknown as ReadableStream, {
		headers: {
			'Content-Type': contentType,
			'Content-Length': String(stats.size),
			'Cache-Control': 'private, max-age=604800'
		}
	});
};

function mimeFor(p: string): string {
	const ext = p.toLowerCase();
	if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg';
	if (ext.endsWith('.png')) return 'image/png';
	if (ext.endsWith('.webp')) return 'image/webp';
	if (ext.endsWith('.gif')) return 'image/gif';
	return 'application/octet-stream';
}

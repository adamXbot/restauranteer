import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { contentTypeFor, resolveSyncPath, type PathRejection } from '$lib/server/sync/paths';
import {
	checkDeletePrecondition,
	checkWritePrecondition,
	deleteSyncFile,
	parseIfMatch,
	readSyncFile,
	statSyncFile,
	writeSyncFile
} from '$lib/server/sync/files';
import { recordTombstone } from '$lib/server/sync/tombstones';
import { log } from '$lib/server/log';

/**
 * Byte-level file transport for the sync protocol. The unit of sync is the
 * file, not "create restaurant" / "add visit" — the semantic API cannot express
 * arbitrary body edits, Obsidian's edits or unknown frontmatter keys, whereas
 * both ends already honour the file format byte-for-byte.
 */

function badPath(reason: PathRejection): Response {
	return json({ error: 'invalid_path', reason }, { status: 400 });
}

function notFound(): Response {
	return json({ error: 'not_found' }, { status: 404 });
}

function conflict(serverSha: string | null): Response {
	return json({ error: 'conflict', server_sha256: serverSha }, { status: 409 });
}

export const GET: RequestHandler = async ({ url }) => {
	const resolved = await resolveSyncPath(url.searchParams.get('path'));
	if (!resolved.ok) return badPath(resolved.reason);

	const file = await readSyncFile(resolved.abs).catch((err) => {
		log.error('Sync read failed', { path: resolved.rel, error: String(err) });
		return null;
	});
	if (!file) return notFound();

	// Buffer is a Uint8Array view; copy into a standalone ArrayBuffer so the
	// Response body never aliases pooled memory.
	const body = new Uint8Array(file.bytes);
	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': contentTypeFor(resolved.rel),
			'Content-Length': String(file.size),
			ETag: `"${file.sha256}"`,
			'X-Vault-Mtime': String(file.mtime),
			'Cache-Control': 'no-store'
		}
	});
};

export const PUT: RequestHandler = async ({ url, request }) => {
	const resolved = await resolveSyncPath(url.searchParams.get('path'));
	if (!resolved.ok) return badPath(resolved.reason);

	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await request.arrayBuffer());
	} catch (err) {
		log.warn('Sync PUT body unreadable', { path: resolved.rel, error: String(err) });
		return json({ error: 'bad_request', message: 'could not read request body' }, { status: 400 });
	}

	const current = await statSyncFile(resolved.abs).catch(() => null);
	const precondition = checkWritePrecondition(parseIfMatch(request.headers.get('if-match')), current);
	if (!precondition.ok) return conflict(precondition.serverSha);

	try {
		const written = await writeSyncFile(resolved.abs, resolved.rel, bytes);
		log.debug('Sync write', { path: resolved.rel, sha256: written.sha256 });
		return json(
			{ sha256: written.sha256, mtime: written.mtime },
			{ headers: { ETag: `"${written.sha256}"`, 'Cache-Control': 'no-store' } }
		);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		// Writing a file where a directory already sits, or vice versa.
		if (code === 'EISDIR' || code === 'ENOTDIR' || code === 'EEXIST') {
			return json({ error: 'invalid_path', reason: 'not_a_file' }, { status: 400 });
		}
		log.error('Sync write failed', { path: resolved.rel, error: String(err) });
		return json({ error: 'write_failed', message: String(err) }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url, request }) => {
	const resolved = await resolveSyncPath(url.searchParams.get('path'));
	if (!resolved.ok) return badPath(resolved.reason);

	const ifMatch = parseIfMatch(request.headers.get('if-match'));
	if (ifMatch.kind === 'absent') {
		// Deleting without stating what you expect to delete is never safe.
		return json(
			{ error: 'if_match_required', message: 'DELETE requires If-Match: "<sha256>" or *' },
			{ status: 400 }
		);
	}

	const current = await statSyncFile(resolved.abs).catch(() => null);
	const precondition = checkDeletePrecondition(ifMatch, current);
	if (!precondition.ok) {
		return precondition.status === 404 ? notFound() : conflict(precondition.serverSha);
	}

	try {
		await deleteSyncFile(resolved.abs, resolved.rel);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') return notFound();
		log.error('Sync delete failed', { path: resolved.rel, error: String(err) });
		return json({ error: 'delete_failed', message: String(err) }, { status: 500 });
	}

	recordTombstone(resolved.rel, current?.sha256 ?? null);
	log.debug('Sync delete', { path: resolved.rel });
	return json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
};

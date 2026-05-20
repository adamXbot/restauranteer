import { error, json } from '@sveltejs/kit';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { discoverRepo, parseRepoRef } from '$lib/server/providers/github';
import { importFromMarkdown } from '$lib/server/vault/importFromMarkdown';
import { buildBundle } from '$lib/server/vault/share';
import { log } from '$lib/server/log';

type Body = {
	repo?: string;
	ref?: string;
	paths?: string[];
	force_new?: boolean;
	resolutions?: Record<string, string>;
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Body | null;
	if (!body?.repo) throw error(400, 'repo required');
	if (!Array.isArray(body.paths) || body.paths.length === 0) {
		throw error(400, 'paths must be a non-empty array');
	}
	const parsed = parseRepoRef(body.repo);
	if (!parsed) throw error(400, 'Not a recognisable GitHub repo reference');
	if (body.ref) parsed.ref = body.ref;

	try {
		const discovery = await discoverRepo(parsed);
		const selected = discovery.files.filter((f) => body.paths!.includes(f.path));
		if (selected.length === 0) throw new Error('Selected files were not found in the repo');

		const files: Array<{ filename: string; content: string }> = [];
		for (const f of selected) {
			const res = await fetch(f.download_url);
			if (!res.ok) throw new Error(`Failed to download ${f.path} (${res.status})`);
			files.push({ filename: path.basename(f.path), content: await res.text() });
		}

		const bundle = buildBundle(files);
		const result = await importFromMarkdown(bundle, {
			forceNew: body.force_new === true,
			resolutions: body.resolutions
		});
		return json({
			...result,
			repo: discovery.repo,
			ref: discovery.resolvedRef,
			hasAttachmentsDir: discovery.hasAttachmentsDir
		});
	} catch (e) {
		log.error('GitHub import failed', { repo: body.repo, error: String(e) });
		throw error(502, String(e instanceof Error ? e.message : e));
	}
};

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importFromMarkdown } from '$lib/server/vault/importFromMarkdown';
import { log } from '$lib/server/log';

type Body = {
	markdown?: string;
	force_new?: boolean;
	resolutions?: Record<string, string>;
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB safety cap

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Body | null;
	if (!body?.markdown || typeof body.markdown !== 'string') {
		throw error(400, 'markdown required');
	}
	if (body.markdown.length > MAX_BYTES) {
		throw error(413, `Markdown exceeds ${MAX_BYTES} bytes`);
	}
	try {
		const result = await importFromMarkdown(body.markdown, {
			forceNew: body.force_new === true,
			resolutions: body.resolutions
		});
		return json(result);
	} catch (e) {
		log.error('Markdown import failed', { error: String(e) });
		throw error(500, String(e instanceof Error ? e.message : e));
	}
};

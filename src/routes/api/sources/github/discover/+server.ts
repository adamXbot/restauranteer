import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { discoverRepo, parseRepoRef } from '$lib/server/providers/github';
import { parse as parseFrontmatter } from '$lib/server/vault/frontmatter';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/vault/types';
import { findVaultCandidates, getRestaurantByUuid } from '$lib/server/db/queries';
import { log } from '$lib/server/log';

type FilePreview = {
	path: string;
	filename: string;
	name: string;
	suburb: string | null;
	cuisine: string[];
	hasFrontmatterId: boolean;
	matchUuid: string | null;
};

export const GET: RequestHandler = async ({ url }) => {
	const ref = url.searchParams.get('repo');
	if (!ref) throw error(400, 'repo query param required (e.g. owner/repo or github.com URL)');
	const parsed = parseRepoRef(ref);
	if (!parsed) throw error(400, 'Not a recognisable GitHub repo reference');
	try {
		const discovery = await discoverRepo(parsed);
		const previews: FilePreview[] = [];
		// Lightweight per-file preview: download each file, peek at frontmatter only.
		for (const f of discovery.files) {
			try {
				const raw = await fetch(f.download_url);
				if (!raw.ok) continue;
				const text = await raw.text();
				const { frontmatter } = parseFrontmatter(text);
				const fmName =
					typeof frontmatter.name === 'string' && frontmatter.name.trim().length > 0
						? frontmatter.name.trim()
						: f.name.replace(/\.md$/i, '');
				const incomingId = typeof frontmatter.id === 'string' ? frontmatter.id : null;
				const existingByUuid = incomingId ? getRestaurantByUuid(incomingId) : null;
				let matchUuid: string | null = existingByUuid?.uuid ?? null;
				if (!matchUuid) {
					const fuzzy = findVaultCandidates(
						fmName,
						typeof frontmatter.lat === 'number' ? frontmatter.lat : null,
						typeof frontmatter.lng === 'number' ? frontmatter.lng : null
					);
					if (fuzzy.length > 0 && fuzzy[0].score >= 0.95) {
						matchUuid = fuzzy[0].restaurant.uuid;
					}
				}
				previews.push({
					path: f.path,
					filename: f.name,
					name: fmName,
					suburb: typeof frontmatter.suburb === 'string' ? frontmatter.suburb : null,
					cuisine: Array.isArray(frontmatter.cuisine)
						? (frontmatter.cuisine as unknown[]).filter((c): c is string => typeof c === 'string')
						: [],
					hasFrontmatterId: incomingId !== null,
					matchUuid
				});
			} catch (e) {
				log.warn('GitHub preview failed for file', { path: f.path, error: String(e) });
			}
		}
		const infoFm = discovery.info
			? parseFrontmatter(discovery.info).frontmatter
			: null;
		const incomingSchema =
			infoFm && typeof infoFm.schema_version === 'number'
				? (infoFm.schema_version as number)
				: null;
		const compatible = incomingSchema === null || incomingSchema <= CURRENT_SCHEMA_VERSION;
		return json({
			repo: discovery.repo,
			ref: discovery.resolvedRef,
			subdir: discovery.subdir,
			info: infoFm,
			compatible,
			hasAttachmentsDir: discovery.hasAttachmentsDir,
			rate_limit: discovery.apiRateLimit,
			files: previews,
			ourSchemaVersion: CURRENT_SCHEMA_VERSION
		});
	} catch (e) {
		log.error('GitHub discover failed', { repo: ref, error: String(e) });
		throw error(502, String(e instanceof Error ? e.message : e));
	}
};

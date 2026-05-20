import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adapters, findAdapterForUrl } from '$lib/server/providers/scraper/registry';
import { CACHE_FOREVER, fetchCached } from '$lib/server/providers/cache';
import {
	createOrLinkFromArticle,
	linkArticleToRestaurant,
	linkRefToRestaurant
} from '$lib/server/vault/createFromArticle';
import { addRestaurantToList } from '$lib/server/vault/importGoogleList';
import { extractGenericLink } from '$lib/server/providers/scraper/genericLink';

async function maybeAddToList(uuid: string | undefined, listName: string | undefined): Promise<void> {
	if (!uuid || !listName) return;
	const trimmed = listName.trim();
	if (!trimmed) return;
	try {
		await addRestaurantToList(uuid, trimmed);
	} catch (e) {
		log.error('add_to_list failed', { uuid, listName: trimmed, error: String(e) });
	}
}
import {
	isGoogleMapsUrl,
	resolveMapsList,
	resolveMapsUrl
} from '$lib/server/providers/mapsResolver';
import { findPlaceByText, hasGoogleKey, placeDetails } from '$lib/server/providers/google';
import {
	createRestaurantFromGooglePlace,
	mergeGooglePlaceIntoRestaurant
} from '$lib/server/vault/create';
import {
	findByArticleUrl,
	findByGooglePlaceId,
	findVaultCandidates
} from '$lib/server/db/queries';
import { log } from '$lib/server/log';

type ImportRequest = {
	url?: string;
	refresh?: boolean;
	link_to_uuid?: string;
	force_new?: boolean;
	/** If set, after a successful create/link the resulting restaurant is
	 * appended to this list (by name). Ignored when the import returns
	 * 'candidates' or 'list_preview'. */
	add_to_list?: string;
};

async function resolveMapsToPlaceId(url: string): Promise<string> {
	const resolved = await resolveMapsUrl(url);
	if (resolved.kind === 'failed') throw error(400, resolved.reason);
	if (resolved.kind === 'placeId') return resolved.placeId;
	const found = await findPlaceByText(resolved.query, {
		lat: resolved.lat,
		lng: resolved.lng,
		radiusMeters: resolved.lat != null ? 500 : undefined
	});
	if (!found) {
		throw error(
			404,
			`Could not find a Google place matching "${resolved.query}". Try the share URL with coordinates.`
		);
	}
	return found;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as ImportRequest | null;
	if (!body?.url || typeof body.url !== 'string') throw error(400, 'url required');
	const forceRefresh = body.refresh === true;
	const forceNew = body.force_new === true;
	const linkTo = body.link_to_uuid;
	const addToList = body.add_to_list;

	// --- Google Maps URLs ---------------------------------------------------
	if (isGoogleMapsUrl(body.url)) {
		if (!hasGoogleKey()) {
			throw error(503, 'Google Maps URLs require GOOGLE_PLACES_API_KEY to be set in .env');
		}

		// Shared-list URL? Return a preview the client can confirm before import.
		const listResult = await resolveMapsList(body.url);
		if (listResult.kind === 'list') {
			if (linkTo) {
				throw error(
					400,
					'Google Maps list URLs hold many places — they can\'t be linked to a single restaurant. Paste a single-place URL instead.'
				);
			}
			return json({
				type: 'list_preview',
				source: 'google',
				name: listResult.name,
				notes: listResult.notes,
				icon: listResult.icon,
				source_url: listResult.source_url,
				place_ids: listResult.place_ids
			});
		}
		if (listResult.kind === 'failed') {
			throw error(400, `Google Maps list URL detected but unreadable: ${listResult.reason}`);
		}

		const placeId = await resolveMapsToPlaceId(body.url);

		// Explicit user choice to merge into a specific vault entry
		if (linkTo) {
			try {
				const result = await mergeGooglePlaceIntoRestaurant(linkTo, placeId);
				await maybeAddToList(result.uuid, addToList);
				return json({ type: 'linked', source: 'google', ...result });
			} catch (e) {
				log.error('Google merge failed', { url: body.url, error: String(e) });
				throw error(500, String(e));
			}
		}

		// Already in vault by Google place_id — silent dedup
		const byPlaceId = findByGooglePlaceId(placeId);
		if (byPlaceId) {
			await maybeAddToList(byPlaceId.uuid, addToList);
			return json({
				type: 'linked',
				source: 'google',
				uuid: byPlaceId.uuid,
				filePath: byPlaceId.file_path,
				merged_fields: []
			});
		}

		// Suggest fuzzy matches unless user asked for a fresh entry
		if (!forceNew) {
			let preview;
			try {
				preview = await placeDetails(placeId);
			} catch (e) {
				log.error('Place preview failed', { placeId, error: String(e) });
				preview = null;
			}
			if (preview) {
				const candidates = findVaultCandidates(preview.name, preview.lat, preview.lng).filter(
					(c) => c.restaurant.google_place_id !== placeId
				);
				if (candidates.length > 0) {
					return json({
						type: 'candidates',
						source: 'google',
						preview: {
							name: preview.name,
							address: preview.address,
							lat: preview.lat,
							lng: preview.lng
						},
						candidates: candidates.map((c) => ({
							uuid: c.restaurant.uuid,
							name: c.restaurant.name,
							suburb: (c.restaurant.frontmatter.suburb as string | undefined) ?? null,
							address: (c.restaurant.frontmatter.address as string | undefined) ?? null,
							score: c.score,
							distance_m: c.distance_m,
							reason: c.reason
						}))
					});
				}
			}
		}

		try {
			const result = await createRestaurantFromGooglePlace(placeId);
			await maybeAddToList(result.uuid, addToList);
			return json({ type: result.alreadyExisted ? 'linked' : 'created', source: 'google', ...result }, {
				status: result.alreadyExisted ? 200 : 201
			});
		} catch (e) {
			log.error('Google Maps import failed', { url: body.url, error: String(e) });
			throw error(500, String(e));
		}
	}

	// --- Article URLs (Broadsheet, Good Food, AGFG, Apple Maps) -------------
	const adapter = findAdapterForUrl(body.url);
	if (!adapter) {
		// Generic-link path: only available when adding to an existing restaurant.
		// We can't infer enough from an arbitrary URL to create a new entry.
		if (linkTo) {
			try {
				const ref = await fetchCached(
					'generic.link',
					body.url,
					CACHE_FOREVER,
					() => extractGenericLink(body.url!),
					{ forceRefresh }
				);
				const result = await linkRefToRestaurant(linkTo, ref);
				await maybeAddToList(result.uuid, addToList);
				return json({ type: 'linked', source: ref.source, ...result });
			} catch (e) {
				log.error('Generic link failed', { url: body.url, error: String(e) });
				throw error(500, String(e));
			}
		}
		const supported = [...adapters.map((a) => a.label), 'Google Maps'].join(', ');
		throw error(
			400,
			`URL not recognised. To create a new restaurant, paste from: ${supported}. ` +
				`To add an arbitrary link (TimeOut, Instagram, TikTok, Reddit, TripAdvisor, …), open the restaurant first and link it from there.`
		);
	}

	// Exact dedup: this URL already attached to a vault restaurant — silent skip
	if (!linkTo) {
		const existing = findByArticleUrl(body.url);
		if (existing) {
			await maybeAddToList(existing.uuid, addToList);
			return json({
				type: 'linked',
				source: adapter.id,
				uuid: existing.uuid,
				filePath: existing.file_path,
				alreadyExisted: true,
				articleAdded: false
			});
		}
	}

	let extracted;
	try {
		extracted = await fetchCached(
			`scrape.${adapter.id}.article`,
			body.url,
			CACHE_FOREVER,
			() => adapter.extract(body.url!),
			{ forceRefresh }
		);
	} catch (e) {
		log.error('Import extract failed', { url: body.url, error: String(e) });
		throw error(502, `Failed to extract: ${String(e)}`);
	}

	// Explicit link to an existing restaurant
	if (linkTo) {
		try {
			const result = await linkArticleToRestaurant(linkTo, extracted);
			await maybeAddToList(result.uuid, addToList);
			return json({ type: 'linked', source: adapter.id, ...result });
		} catch (e) {
			log.error('Article link failed', { url: body.url, error: String(e) });
			throw error(500, String(e));
		}
	}

	// Suggest fuzzy matches before creating a duplicate
	if (!forceNew) {
		const candidates = findVaultCandidates(extracted.name, extracted.lat, extracted.lng);
		// Skip if any candidate is already linked to this exact article (handled by createOrLinkFromArticle)
		const stillCandidates = candidates;
		if (stillCandidates.length > 0) {
			return json({
				type: 'candidates',
				source: adapter.id,
				preview: {
					name: extracted.name,
					address: extracted.address,
					lat: extracted.lat,
					lng: extracted.lng
				},
				candidates: stillCandidates.map((c) => ({
					uuid: c.restaurant.uuid,
					name: c.restaurant.name,
					suburb: (c.restaurant.frontmatter.suburb as string | undefined) ?? null,
					address: (c.restaurant.frontmatter.address as string | undefined) ?? null,
					score: c.score,
					distance_m: c.distance_m,
					reason: c.reason
				}))
			});
		}
	}

	try {
		const result = await createOrLinkFromArticle(extracted);
		await maybeAddToList(result.uuid, addToList);
		return json(
			{ type: result.alreadyExisted ? 'linked' : 'created', source: adapter.id, ...result },
			{ status: result.alreadyExisted ? 200 : 201 }
		);
	} catch (e) {
		log.error('Import save failed', { url: body.url, error: String(e) });
		throw error(500, String(e));
	}
};

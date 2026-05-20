import path from 'node:path';
import { newId } from '../uuid';
import { findVaultCandidates, getRestaurantByUuid } from '../db/queries';
import { readRestaurant } from './reader';
import { resolveCollisionFreePath } from './filename';
import { sanitizeFilename } from './filename';
import { saveRestaurant } from './save';
import { CURRENT_SCHEMA_VERSION, type Frontmatter } from './types';
import {
	compareSchemaVersions,
	parseBundle,
	type ParsedBundle,
	type ParsedBundleFile
} from './share';
import { restaurantsDir } from '../config';
import { log } from '../log';

export type ImportFileOutcome =
	| {
			status: 'created' | 'merged' | 'skipped';
			filename: string | null;
			name: string;
			uuid: string;
			filePath: string;
	  }
	| {
			status: 'candidates';
			filename: string | null;
			name: string;
			candidates: Array<{
				uuid: string;
				name: string;
				suburb: string | null;
				address: string | null;
				score: number;
				distance_m: number | null;
				reason: 'exact_name' | 'name_subset' | 'token_overlap';
			}>;
	  }
	| {
			status: 'error';
			filename: string | null;
			name: string;
			error: string;
	  };

export type ImportBundleResult = {
	info: {
		generated_by?: string;
		app_version?: string;
		schema_version?: number;
	} | null;
	schemaWarning: string | null;
	files: ImportFileOutcome[];
};

export type ImportOptions = {
	/** When true, skip the fuzzy-match check and just create new entries. */
	forceNew?: boolean;
	/**
	 * Map from a `filename` (as it appeared in the bundle) to a directive:
	 *   - `'create'`  → always create as new (even if a fuzzy match exists)
	 *   - `'<uuid>'` → merge into an existing restaurant by uuid
	 *   - `'skip'`   → don't import this file
	 * Files not listed fall back to the default flow.
	 */
	resolutions?: Record<string, string>;
};

function nameFromFrontmatter(file: ParsedBundleFile): string {
	if (typeof file.frontmatter.name === 'string' && file.frontmatter.name.trim().length > 0) {
		return file.frontmatter.name.trim();
	}
	if (file.filename) return file.filename.replace(/\.md$/i, '');
	return 'Imported restaurant';
}

function rebodyFromArray(body: string): string {
	return body.startsWith('\n') ? body.slice(1) : body;
}

function frontmatterForImport(
	incoming: Frontmatter,
	uuid: string,
	name: string
): Frontmatter {
	const out: Frontmatter = { ...incoming };
	out.id = uuid;
	out.schema_version = CURRENT_SCHEMA_VERSION;
	out.name = name;
	if (!out.last_synced) out.last_synced = new Date().toISOString();
	// Strip MOC-only / generator fields that shouldn't appear on restaurants
	delete out.generated_by;
	delete out.do_not_edit;
	delete out.list_name;
	delete out.bundle_kind;
	delete out.app_version;
	delete out.generated_at;
	return out;
}

async function importOneFile(
	file: ParsedBundleFile,
	opts: ImportOptions
): Promise<ImportFileOutcome> {
	const name = nameFromFrontmatter(file);
	const filename = file.filename;
	const resolution = filename ? opts.resolutions?.[filename] : undefined;

	if (resolution === 'skip') {
		return {
			status: 'skipped',
			filename,
			name,
			uuid: '',
			filePath: ''
		};
	}

	const fm = file.frontmatter;
	const incomingId = typeof fm.id === 'string' ? fm.id : null;

	// 1. UUID match — silent merge target. Resolution can override.
	if (resolution && resolution !== 'create') {
		const target = getRestaurantByUuid(resolution);
		if (!target) {
			return {
				status: 'error',
				filename,
				name,
				error: `Merge target ${resolution} not found`
			};
		}
		return await mergeIntoExisting(target.uuid, target.file_path, file, name);
	}
	if (incomingId && resolution !== 'create') {
		const target = getRestaurantByUuid(incomingId);
		if (target) {
			return await mergeIntoExisting(target.uuid, target.file_path, file, name);
		}
	}

	// 2. Fuzzy match — suggest candidates unless overridden
	if (!opts.forceNew && resolution !== 'create') {
		const lat = typeof fm.lat === 'number' ? fm.lat : null;
		const lng = typeof fm.lng === 'number' ? fm.lng : null;
		const matches = findVaultCandidates(name, lat, lng).filter(
			(m) => !incomingId || m.restaurant.uuid !== incomingId
		);
		if (matches.length > 0) {
			return {
				status: 'candidates',
				filename,
				name,
				candidates: matches.map((c) => ({
					uuid: c.restaurant.uuid,
					name: c.restaurant.name,
					suburb: (c.restaurant.frontmatter.suburb as string | undefined) ?? null,
					address: (c.restaurant.frontmatter.address as string | undefined) ?? null,
					score: c.score,
					distance_m: c.distance_m,
					reason: c.reason
				}))
			};
		}
	}

	// 3. Create new
	const uuid = incomingId ?? newId();
	const suburb = typeof fm.suburb === 'string' ? fm.suburb : null;
	const desiredBasename = filename
		? sanitizeFilename(filename.replace(/\.md$/i, ''))
		: sanitizeFilename(name);
	const filePath = await resolveCollisionFreePath(desiredBasename, suburb);
	const newFm = frontmatterForImport(fm, uuid, name);
	const body = rebodyFromArray(file.body);
	await saveRestaurant(filePath, newFm, body, {
		affectedLists: Array.isArray(newFm.lists) ? (newFm.lists as string[]) : []
	});
	return { status: 'created', filename, name, uuid, filePath };
}

async function mergeIntoExisting(
	uuid: string,
	filePath: string,
	file: ParsedBundleFile,
	name: string
): Promise<ImportFileOutcome> {
	const existing = await readRestaurant(filePath);
	const merged: Frontmatter = mergeFrontmatter(existing.frontmatter, file.frontmatter);
	merged.id = uuid;
	merged.schema_version = CURRENT_SCHEMA_VERSION;
	// Keep the existing display name unless the incoming file is empty
	if (!merged.name) merged.name = name;
	const body = file.body.trim().length > existing.body.trim().length ? file.body : existing.body;
	const affected = Array.isArray(merged.lists) ? (merged.lists as string[]) : [];
	const previousLists = Array.isArray(existing.frontmatter.lists)
		? (existing.frontmatter.lists as string[])
		: [];
	const allAffected = Array.from(new Set([...affected, ...previousLists]));
	await saveRestaurant(filePath, merged, body, { affectedLists: allAffected });
	return { status: 'merged', filename: file.filename, name, uuid, filePath };
}

/**
 * Conservative field-by-field merge:
 *  - scalars: prefer existing non-empty value
 *  - arrays: union, deduped (case-insensitive for tags/lists/cuisine)
 *  - articles: union by url
 *  - place_ids / socials / hours: shallow merge, existing wins
 */
function mergeFrontmatter(existing: Frontmatter, incoming: Frontmatter): Frontmatter {
	const out: Frontmatter = { ...existing };

	const ARRAY_FIELDS = ['cuisine', 'tags', 'lists', 'aliases'] as const;
	for (const field of ARRAY_FIELDS) {
		const a = Array.isArray(existing[field]) ? (existing[field] as unknown[]) : [];
		const b = Array.isArray(incoming[field]) ? (incoming[field] as unknown[]) : [];
		if (a.length === 0 && b.length === 0) continue;
		const seen = new Set<string>();
		const result: string[] = [];
		for (const item of [...a, ...b]) {
			if (typeof item !== 'string') continue;
			const key = item.toLowerCase().trim();
			if (key && !seen.has(key)) {
				seen.add(key);
				result.push(item.trim());
			}
		}
		out[field] = result;
	}

	// Articles — dedup by url
	const existingArts = Array.isArray(existing.articles)
		? (existing.articles as Array<Record<string, unknown>>)
		: [];
	const incomingArts = Array.isArray(incoming.articles)
		? (incoming.articles as Array<Record<string, unknown>>)
		: [];
	if (existingArts.length > 0 || incomingArts.length > 0) {
		const seenUrls = new Set<string>();
		const merged: Array<Record<string, unknown>> = [];
		for (const a of [...existingArts, ...incomingArts]) {
			const url = typeof a?.url === 'string' ? a.url : null;
			if (!url || seenUrls.has(url)) continue;
			seenUrls.add(url);
			merged.push(a);
		}
		out.articles = merged;
	}

	// Object-shaped fields — existing wins per key
	const OBJECT_FIELDS = ['place_ids', 'socials', 'hours'] as const;
	const outRecord = out as Record<string, unknown>;
	for (const field of OBJECT_FIELDS) {
		const a = (existing[field] as Record<string, unknown> | undefined) ?? null;
		const b = (incoming[field] as Record<string, unknown> | undefined) ?? null;
		if (!a && !b) continue;
		outRecord[field] = { ...(b ?? {}), ...(a ?? {}) };
	}

	// Scalars — keep existing unless missing
	const SCALAR_FIELDS = [
		'address',
		'suburb',
		'lat',
		'lng',
		'phone',
		'website',
		'price_level',
		'rating'
	] as const;
	for (const field of SCALAR_FIELDS) {
		if (
			(existing[field] === undefined || existing[field] === null || existing[field] === '') &&
			incoming[field] !== undefined
		) {
			outRecord[field] = incoming[field];
		}
	}

	out.last_synced = new Date().toISOString();
	return out;
}

function schemaWarning(parsed: ParsedBundle): string | null {
	const info = parsed.info;
	if (!info) return null;
	const incoming =
		typeof info.schema_version === 'number' ? info.schema_version : null;
	if (incoming === null) return null;
	const cmp = compareSchemaVersions(incoming, CURRENT_SCHEMA_VERSION);
	if (cmp > 0) {
		return `Bundle schema_version is ${incoming}, this app supports ${CURRENT_SCHEMA_VERSION}. Some fields may be ignored.`;
	}
	return null;
}

export async function importFromMarkdown(
	text: string,
	opts: ImportOptions = {}
): Promise<ImportBundleResult> {
	const parsed = parseBundle(text);
	const warning = schemaWarning(parsed);
	if (parsed.files.length === 0) {
		return { info: parsed.info, schemaWarning: warning, files: [] };
	}
	log.info('Importing markdown', {
		fileCount: parsed.files.length,
		hasInfo: parsed.info !== null,
		vault: restaurantsDir()
	});
	const outcomes: ImportFileOutcome[] = [];
	for (const file of parsed.files) {
		try {
			const result = await importOneFile(file, opts);
			outcomes.push(result);
		} catch (e) {
			outcomes.push({
				status: 'error',
				filename: file.filename,
				name: nameFromFrontmatter(file),
				error: String(e instanceof Error ? e.message : e)
			});
		}
	}
	return { info: parsed.info, schemaWarning: warning, files: outcomes };
}

export function dataFolderHint(): string {
	return path.basename(restaurantsDir());
}

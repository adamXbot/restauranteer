import { getRestaurantByUuid } from './db/queries';
import { readRestaurant } from './vault/reader';
import { saveRestaurant } from './vault/save';
import { findAdapterForUrl } from './providers/scraper/registry';
import { CACHE_FOREVER, fetchCached } from './providers/cache';
import { cuisinesFromTypes, hasGoogleKey, placeDetails } from './providers/google';
import { log } from './log';
import type { Frontmatter } from './vault/types';

export type ComparisonField =
	| 'name'
	| 'address'
	| 'suburb'
	| 'phone'
	| 'website'
	| 'lat'
	| 'lng'
	| 'cuisine';

export const COMPARISON_FIELDS: ComparisonField[] = [
	'name',
	'address',
	'suburb',
	'phone',
	'website',
	'lat',
	'lng',
	'cuisine'
];

export type ComparisonValues = {
	name?: string | null;
	address?: string | null;
	suburb?: string | null;
	phone?: string | null;
	website?: string | null;
	lat?: number | null;
	lng?: number | null;
	cuisine?: string[];
};

export type ComparisonSource = {
	id: string; // 'current' | 'google' | `article:${url}`
	label: string; // 'Current (vault)' | 'Google Places' | 'Broadsheet' | etc.
	url: string | null;
	values: ComparisonValues;
};

export type Comparison = {
	uuid: string;
	name: string;
	fields: ComparisonField[];
	sources: ComparisonSource[];
};

function vaultValues(fm: Frontmatter): ComparisonValues {
	return {
		name: typeof fm.name === 'string' ? fm.name : null,
		address: typeof fm.address === 'string' ? fm.address : null,
		suburb: typeof fm.suburb === 'string' ? fm.suburb : null,
		phone: typeof fm.phone === 'string' ? fm.phone : null,
		website: typeof fm.website === 'string' ? fm.website : null,
		lat: typeof fm.lat === 'number' ? fm.lat : null,
		lng: typeof fm.lng === 'number' ? fm.lng : null,
		cuisine: Array.isArray(fm.cuisine) ? (fm.cuisine as string[]) : []
	};
}

export async function gatherComparison(uuid: string): Promise<Comparison> {
	const indexed = getRestaurantByUuid(uuid);
	if (!indexed) throw new Error('Restaurant not found');

	const rf = await readRestaurant(indexed.file_path);
	const fm = rf.frontmatter;

	const sources: ComparisonSource[] = [];

	sources.push({
		id: 'current',
		label: 'Current (vault)',
		url: null,
		values: vaultValues(fm)
	});

	const articles =
		(fm.articles as Array<{ source: string; url: string; title?: string }> | undefined) ?? [];
	for (const article of articles) {
		const adapter = findAdapterForUrl(article.url);
		if (!adapter) continue;
		try {
			const extracted = await fetchCached(
				`scrape.${adapter.id}.article`,
				article.url,
				CACHE_FOREVER,
				() => adapter.extract(article.url)
			);
			sources.push({
				id: `article:${article.url}`,
				label: adapter.label,
				url: article.url,
				values: {
					name: extracted.name || null,
					address: extracted.address,
					suburb: extracted.suburb,
					phone: extracted.phone,
					website: extracted.website,
					lat: extracted.lat,
					lng: extracted.lng,
					cuisine: extracted.cuisine
				}
			});
		} catch (e) {
			log.error('Compare: article extract failed', { url: article.url, error: String(e) });
		}
	}

	const placeIds = (fm.place_ids as Record<string, string> | undefined) ?? {};
	if (placeIds.google && hasGoogleKey()) {
		try {
			const place = await placeDetails(placeIds.google);
			sources.push({
				id: 'google',
				label: 'Google Places',
				url: place.google_maps_uri,
				values: {
					name: place.name || null,
					address: place.address,
					suburb: null, // Google's formatted address already includes locality
					phone: place.phone,
					website: place.website,
					lat: place.lat,
					lng: place.lng,
					cuisine: cuisinesFromTypes(place.types)
				}
			});
		} catch (e) {
			log.error('Compare: Google place fetch failed', {
				placeId: placeIds.google,
				error: String(e)
			});
		}
	}

	return {
		uuid: indexed.uuid,
		name: indexed.name,
		fields: COMPARISON_FIELDS,
		sources
	};
}

function getFieldValue(source: ComparisonSource, field: ComparisonField): unknown {
	return source.values[field];
}

/**
 * Apply per-field source selections to the vault entry. Selections is a map
 * of field → source id (the 'current' id is treated as a no-op).
 */
export async function applyComparisonSelections(
	uuid: string,
	selections: Partial<Record<ComparisonField, string>>
): Promise<{ updated: ComparisonField[]; unchanged: ComparisonField[] }> {
	const comparison = await gatherComparison(uuid);
	const indexed = getRestaurantByUuid(uuid);
	if (!indexed) throw new Error('Restaurant not found');
	const rf = await readRestaurant(indexed.file_path);
	const fm: Frontmatter = { ...rf.frontmatter };

	const sourceMap = new Map(comparison.sources.map((s) => [s.id, s]));
	const updated: ComparisonField[] = [];
	const unchanged: ComparisonField[] = [];

	for (const field of COMPARISON_FIELDS) {
		const sourceId = selections[field];
		if (!sourceId || sourceId === 'current') {
			unchanged.push(field);
			continue;
		}
		const source = sourceMap.get(sourceId);
		if (!source) {
			unchanged.push(field);
			continue;
		}
		const newValue = getFieldValue(source, field);
		const currentValue = getFieldValue(
			comparison.sources.find((s) => s.id === 'current')!,
			field
		);
		if (JSON.stringify(newValue) === JSON.stringify(currentValue)) {
			unchanged.push(field);
			continue;
		}
		if (newValue === null || newValue === undefined) {
			delete (fm as Record<string, unknown>)[field];
		} else {
			(fm as Record<string, unknown>)[field] = newValue;
		}
		updated.push(field);
	}

	if (updated.length > 0) {
		fm.last_synced = new Date().toISOString();
		await saveRestaurant(indexed.file_path, fm, rf.body);
	}

	return { updated, unchanged };
}

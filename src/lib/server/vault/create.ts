import path from 'node:path';
import { newId } from '../uuid';
import { cuisinesFromTypes, placeDetails, type PlaceDetails } from '../providers/google';
import { findByGooglePlaceId, getRestaurantByUuid } from '../db/queries';
import { readRestaurant } from './reader';
import { resolveCollisionFreePath } from './filename';
import { saveRestaurant } from './save';
import { CURRENT_SCHEMA_VERSION, type Frontmatter } from './types';
import { restaurantsDir } from '../config';

export type CreateResult = {
	uuid: string;
	filePath: string;
	alreadyExisted: boolean;
};

export async function createRestaurantFromGooglePlace(placeId: string): Promise<CreateResult> {
	const existing = findByGooglePlaceId(placeId);
	if (existing) {
		return { uuid: existing.uuid, filePath: existing.file_path, alreadyExisted: true };
	}

	const place = await placeDetails(placeId);
	const filePath = await resolveCollisionFreePath(
		place.name || `Restaurant ${placeId.slice(0, 6)}`,
		suburbFromAddress(place.address)
	);

	const uuid = newId();
	const frontmatter = buildFrontmatter(uuid, place);
	const body = buildInitialBody(place);

	await saveRestaurant(filePath, frontmatter, body, {
		affectedLists: Array.isArray(frontmatter.lists) ? frontmatter.lists : []
	});

	return { uuid, filePath, alreadyExisted: false };
}

function buildFrontmatter(uuid: string, place: PlaceDetails): Frontmatter {
	const cuisines = cuisinesFromTypes(place.types);
	const suburb = suburbFromAddress(place.address);
	return {
		id: uuid,
		schema_version: CURRENT_SCHEMA_VERSION,
		name: place.name,
		address: place.address ?? undefined,
		suburb: suburb ?? undefined,
		lat: place.lat ?? undefined,
		lng: place.lng ?? undefined,
		phone: place.phone ?? undefined,
		website: place.website ?? undefined,
		cuisine: cuisines.length > 0 ? cuisines : undefined,
		price_level: place.price_level ?? undefined,
		hours: place.hours ?? undefined,
		place_ids: { google: place.id },
		lists: [],
		tags: [],
		last_synced: new Date().toISOString()
	};
}

function buildInitialBody(place: PlaceDetails): string {
	const lines: string[] = [];
	lines.push('## Overview', '');
	if (place.rating != null && place.user_rating_count != null) {
		lines.push(
			`Google: ★ ${place.rating} (${place.user_rating_count.toLocaleString()} reviews)`,
			''
		);
	}
	if (place.website) {
		lines.push('## Menu', '', `- [Online menu](${place.website})`, '');
	}
	lines.push('## Visits', '');
	return lines.join('\n');
}

function suburbFromAddress(address: string | null): string | null {
	if (!address) return null;
	// Australian address pattern: "<street>, <suburb> <STATE> <postcode>, <country?>"
	const parts = address.split(',').map((s) => s.trim());
	if (parts.length < 2) return null;
	const stateLine = parts[1];
	const m = stateLine.match(/^(.+?)\s+(VIC|NSW|QLD|WA|SA|TAS|NT|ACT)/i);
	return m ? m[1] : stateLine;
}

/**
 * Create a new restaurant from minimal user-provided info — no external place
 * lookup. Used by the inbox flow when a link arrives for a venue that isn't
 * in Google's index (or for which we don't have enough to identify it).
 */
export async function createBlankRestaurant(input: {
	name: string;
	suburb?: string | null;
	address?: string | null;
	cuisine?: string[];
}): Promise<{ uuid: string; filePath: string }> {
	const name = input.name.trim();
	if (!name) throw new Error('Restaurant name required');
	const cuisines = (input.cuisine ?? []).map((c) => c.trim()).filter(Boolean);
	const filePath = await resolveCollisionFreePath(name, input.suburb ?? null);
	const uuid = newId();
	const frontmatter: Frontmatter = {
		id: uuid,
		schema_version: CURRENT_SCHEMA_VERSION,
		name,
		address: input.address?.trim() || undefined,
		suburb: input.suburb?.trim() || undefined,
		cuisine: cuisines.length > 0 ? cuisines : undefined,
		lists: [],
		tags: [],
		last_synced: new Date().toISOString()
	};
	const body = '## Overview\n\n## Visits\n';
	await saveRestaurant(filePath, frontmatter, body);
	return { uuid, filePath };
}

/** Sanity check: ensure a file path is inside the configured vault root. */
export function isPathInsideVault(filePath: string): boolean {
	const root = path.resolve(restaurantsDir());
	const resolved = path.resolve(filePath);
	return resolved.startsWith(root + path.sep) || resolved === root;
}

export type MergeResult = {
	uuid: string;
	filePath: string;
	merged_fields: string[];
};

/**
 * Pull Google Place data into an existing vault restaurant. Fills in any
 * frontmatter fields that are currently empty without overwriting user data
 * (lists, tags, rating, notes are never touched).
 */
export async function mergeGooglePlaceIntoRestaurant(
	uuid: string,
	placeId: string
): Promise<MergeResult> {
	const indexed = getRestaurantByUuid(uuid);
	if (!indexed) throw new Error(`Restaurant ${uuid} not found`);

	const place = await placeDetails(placeId);
	const rf = await readRestaurant(indexed.file_path);
	const fm: Frontmatter = { ...rf.frontmatter };
	const merged: string[] = [];

	const placeIds = (fm.place_ids as Record<string, string> | undefined) ?? {};
	if (placeIds.google !== placeId) {
		fm.place_ids = { ...placeIds, google: placeId };
		merged.push('place_ids.google');
	}

	const fill = <K extends keyof Frontmatter>(key: K, value: Frontmatter[K] | null | undefined) => {
		if (value == null) return;
		const existing = fm[key];
		const empty =
			existing == null ||
			(typeof existing === 'string' && existing.trim() === '') ||
			(Array.isArray(existing) && existing.length === 0);
		if (empty) {
			fm[key] = value;
			merged.push(String(key));
		}
	};

	fill('address', place.address ?? undefined);
	if (place.address) {
		const suburb = suburbFromAddress(place.address);
		if (suburb) fill('suburb', suburb);
	}
	fill('lat', place.lat ?? undefined);
	fill('lng', place.lng ?? undefined);
	fill('phone', place.phone ?? undefined);
	fill('website', place.website ?? undefined);
	fill('hours', place.hours ?? undefined);
	fill('price_level', place.price_level ?? undefined);

	const cuisines = cuisinesFromTypes(place.types);
	if (cuisines.length > 0) fill('cuisine', cuisines);

	fm.last_synced = new Date().toISOString();
	await saveRestaurant(indexed.file_path, fm, rf.body);

	return { uuid: indexed.uuid, filePath: indexed.file_path, merged_fields: merged };
}

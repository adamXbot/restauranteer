import { getRestaurantByUuid, findByGooglePlaceId } from '../db/queries';
import { readRestaurant } from './reader';
import { saveRestaurant } from './save';
import { createRestaurantFromGooglePlace } from './create';
import type { Frontmatter, ListMembership } from './types';
import { log } from '../log';

export type ImportListInput = {
	list_name: string;
	notes: string | null;
	icon: string | null;
	source_url: string | null;
	place_ids: string[];
};

export type ImportListPlaceResult = {
	place_id: string;
	status: 'created' | 'linked' | 'error';
	uuid?: string;
	filePath?: string;
	error?: string;
};

export type ImportListResult = {
	list_name: string;
	places: ImportListPlaceResult[];
	created: number;
	linked: number;
	errors: number;
};

/**
 * Import a list of Google place IDs into a single vault list, attaching the
 * imported metadata (notes/icon/source) to each restaurant's
 * `list_memberships`. Restaurants already in the vault are linked rather than
 * duplicated.
 */
export async function importGoogleList(input: ImportListInput): Promise<ImportListResult> {
	const listName = input.list_name.trim();
	if (!listName) throw new Error('list_name required');

	const results: ImportListPlaceResult[] = [];
	let created = 0;
	let linked = 0;
	let errors = 0;

	for (const placeId of input.place_ids) {
		try {
			const existing = findByGooglePlaceId(placeId);
			let uuid: string;
			let filePath: string;
			let wasCreated = false;
			if (existing) {
				uuid = existing.uuid;
				filePath = existing.file_path;
			} else {
				const r = await createRestaurantFromGooglePlace(placeId);
				uuid = r.uuid;
				filePath = r.filePath;
				wasCreated = !r.alreadyExisted;
			}

			await attachListMembership(uuid, {
				list_name: listName,
				notes: input.notes,
				icon: input.icon,
				source_url: input.source_url
			});

			if (wasCreated) created++;
			else linked++;
			results.push({
				place_id: placeId,
				status: wasCreated ? 'created' : 'linked',
				uuid,
				filePath
			});
		} catch (e) {
			errors++;
			const msg = e instanceof Error ? e.message : String(e);
			log.error('importGoogleList place failed', { place_id: placeId, error: msg });
			results.push({ place_id: placeId, status: 'error', error: msg });
		}
	}

	return { list_name: listName, places: results, created, linked, errors };
}

/**
 * Add this restaurant to `list_name` (if not already in it) and stamp the
 * list_memberships entry with imported metadata.
 */
async function attachListMembership(
	uuid: string,
	input: {
		list_name: string;
		notes: string | null;
		icon: string | null;
		source_url: string | null;
	}
): Promise<void> {
	const indexed = getRestaurantByUuid(uuid);
	if (!indexed) throw new Error(`Restaurant ${uuid} not found`);
	const rf = await readRestaurant(indexed.file_path);
	const fm: Frontmatter = { ...rf.frontmatter };

	const lists = Array.isArray(fm.lists) ? [...fm.lists] : [];
	if (!lists.includes(input.list_name)) lists.push(input.list_name);
	fm.lists = lists;

	const memberships = Array.isArray(fm.list_memberships)
		? [...(fm.list_memberships as ListMembership[])]
		: [];
	const existingIdx = memberships.findIndex(
		(m) => m && typeof m === 'object' && m.list === input.list_name
	);
	const next: ListMembership = {
		list: input.list_name,
		...(input.notes ? { notes: input.notes } : {}),
		...(input.icon ? { icon: input.icon } : {}),
		...(input.source_url ? { source_url: input.source_url } : {}),
		imported_at: new Date().toISOString()
	};
	if (existingIdx >= 0) memberships[existingIdx] = next;
	else memberships.push(next);
	fm.list_memberships = memberships;

	fm.last_synced = new Date().toISOString();
	await saveRestaurant(indexed.file_path, fm, rf.body, {
		affectedLists: [input.list_name]
	});
}

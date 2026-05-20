import { getRestaurantByUuid, findByGooglePlaceId } from '../db/queries';
import { readRestaurant } from './reader';
import { saveRestaurant } from './save';
import { createRestaurantFromGooglePlace } from './create';
import { setListMetadata } from './moc';
import type { Frontmatter } from './types';
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
 * Import a list of Google place IDs into a single vault list. List-level
 * metadata (notes, icon, source URL, imported_at) is written once to the MOC
 * file at `_Lists/{name}.md`; restaurants only get `list_name` appended to
 * their `lists[]`. Restaurants already in the vault are linked rather than
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

			await addRestaurantToList(uuid, listName);

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

	// Write list-level metadata to the MOC once, regardless of how many places
	// imported successfully. Even a metadata-only list (no places yet) gets the
	// MOC file as a shell so the user can still see the notes/icon.
	await setListMetadata(listName, {
		notes: input.notes,
		icon: input.icon,
		source_url: input.source_url,
		imported_at: new Date().toISOString()
	});

	return { list_name: listName, places: results, created, linked, errors };
}

/** Append a list_name to a restaurant's `lists[]` if not already present. */
export async function addRestaurantToList(uuid: string, listName: string): Promise<void> {
	const indexed = getRestaurantByUuid(uuid);
	if (!indexed) throw new Error(`Restaurant ${uuid} not found`);
	const rf = await readRestaurant(indexed.file_path);
	const fm: Frontmatter = { ...rf.frontmatter };

	const lists = Array.isArray(fm.lists) ? [...fm.lists] : [];
	if (lists.includes(listName)) return;
	lists.push(listName);
	fm.lists = lists;
	fm.last_synced = new Date().toISOString();
	await saveRestaurant(indexed.file_path, fm, rf.body, {
		affectedLists: [listName]
	});
}

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'restauranteer';
const DB_VERSION = 1;
const STORE = 'pendingVisits';

export type QueuedVisit = {
	localId: string;
	restaurantUuid: string;
	restaurantName: string;
	fields: Record<string, string>;
	photos: Blob[];
	/**
	 * Optional form-field name for each entry in `photos` (parallel array). Used
	 * to keep per-dish photos mapped to `dish_photo_<i>` fields. Defaults to
	 * `photo` when absent — older queued visits stay valid.
	 */
	photoFields?: string[];
	createdAt: number;
	retries: number;
	lastError?: string;
	lastTriedAt?: number;
};

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB not available'));
	}
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, DB_VERSION, {
			upgrade(d) {
				if (!d.objectStoreNames.contains(STORE)) {
					const store = d.createObjectStore(STORE, { keyPath: 'localId' });
					store.createIndex('by_restaurant', 'restaurantUuid');
					store.createIndex('by_created', 'createdAt');
				}
			}
		});
	}
	return dbPromise;
}

export async function enqueueVisit(
	visit: Omit<QueuedVisit, 'localId' | 'createdAt' | 'retries'>
): Promise<string> {
	const localId = crypto.randomUUID();
	const full: QueuedVisit = {
		...visit,
		localId,
		createdAt: Date.now(),
		retries: 0
	};
	const d = await db();
	await d.put(STORE, full);
	return localId;
}

export async function getAllPending(): Promise<QueuedVisit[]> {
	const d = await db();
	return d.getAll(STORE);
}

export async function countPending(): Promise<number> {
	try {
		const d = await db();
		return d.count(STORE);
	} catch {
		return 0;
	}
}

export async function getPendingForRestaurant(uuid: string): Promise<QueuedVisit[]> {
	const d = await db();
	return d.getAllFromIndex(STORE, 'by_restaurant', uuid);
}

export async function removePending(localId: string): Promise<void> {
	const d = await db();
	await d.delete(STORE, localId);
}

async function markRetry(localId: string, error: string): Promise<void> {
	const d = await db();
	const v = (await d.get(STORE, localId)) as QueuedVisit | undefined;
	if (!v) return;
	v.retries += 1;
	v.lastError = error;
	v.lastTriedAt = Date.now();
	await d.put(STORE, v);
}

export type FlushResult = {
	attempted: number;
	succeeded: number;
	failed: number;
	dropped: number;
};

/**
 * Attempt to POST every queued visit. Pure successes are removed from the
 * queue. Network failures and 5xx errors increment retries and remain queued.
 * 4xx client errors are recorded but the entry is left in place too so the
 * user can see what failed.
 */
export async function flushQueue(): Promise<FlushResult> {
	const pending = await getAllPending();
	let succeeded = 0;
	let failed = 0;
	let dropped = 0;
	for (const visit of pending) {
		try {
			const form = new FormData();
			for (const [k, v] of Object.entries(visit.fields)) {
				if (v) form.set(k, v);
			}
			for (let i = 0; i < visit.photos.length; i++) {
				const field = visit.photoFields?.[i] ?? 'photo';
				form.append(field, visit.photos[i], `${field}-${i + 1}.jpg`);
			}
			const res = await fetch(`/api/restaurants/${visit.restaurantUuid}/visits`, {
				method: 'POST',
				body: form
			});
			if (res.ok) {
				await removePending(visit.localId);
				succeeded++;
			} else {
				await markRetry(visit.localId, `HTTP ${res.status}`);
				failed++;
			}
		} catch (e) {
			// Network error — almost certainly offline still
			await markRetry(visit.localId, String(e));
			failed++;
		}
	}
	return { attempted: pending.length, succeeded, failed, dropped };
}

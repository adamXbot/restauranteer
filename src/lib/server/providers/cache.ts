import { getDb } from '../db/schema';

type CacheRow = { payload_json: string; fetched_at: number; ttl_seconds: number };

/** Pass this as `ttlSeconds` to mean "cache forever — only refresh on explicit user request". */
export const CACHE_FOREVER = 0;

export function getCached<T>(provider: string, key: string): T | null {
	const row = getDb()
		.prepare(
			'SELECT payload_json, fetched_at, ttl_seconds FROM api_cache WHERE provider = ? AND cache_key = ?'
		)
		.get(provider, key) as CacheRow | undefined;
	if (!row) return null;
	// ttl_seconds = 0 means "never expire"
	if (row.ttl_seconds > 0) {
		const expiresAt = row.fetched_at + row.ttl_seconds * 1000;
		if (Date.now() > expiresAt) return null;
	}
	return JSON.parse(row.payload_json) as T;
}

export function setCached(
	provider: string,
	key: string,
	payload: unknown,
	ttlSeconds: number
): void {
	getDb()
		.prepare(
			`INSERT OR REPLACE INTO api_cache (provider, cache_key, payload_json, fetched_at, ttl_seconds)
			 VALUES (?, ?, ?, ?, ?)`
		)
		.run(provider, key, JSON.stringify(payload), Date.now(), ttlSeconds);
}

export function deleteCached(provider: string, key: string): boolean {
	const info = getDb()
		.prepare('DELETE FROM api_cache WHERE provider = ? AND cache_key = ?')
		.run(provider, key);
	return info.changes > 0;
}

export function deleteCachedByProvider(providerPrefix: string): number {
	const info = getDb()
		.prepare("DELETE FROM api_cache WHERE provider = ? OR provider LIKE ?")
		.run(providerPrefix, `${providerPrefix}.%`);
	return info.changes;
}

export function clearAllCache(): number {
	const info = getDb().prepare('DELETE FROM api_cache').run();
	return info.changes;
}

export function cacheStats(): {
	total: number;
	by_provider: { provider: string; count: number; oldest_fetched_at: number | null }[];
} {
	const db = getDb();
	const totalRow = db.prepare('SELECT COUNT(*) AS c FROM api_cache').get() as { c: number };
	const byProvider = db
		.prepare(
			`SELECT provider,
			        COUNT(*) AS count,
			        MIN(fetched_at) AS oldest_fetched_at
			 FROM api_cache
			 GROUP BY provider
			 ORDER BY provider`
		)
		.all() as { provider: string; count: number; oldest_fetched_at: number | null }[];
	return { total: totalRow.c, by_provider: byProvider };
}

export async function fetchCached<T>(
	provider: string,
	key: string,
	ttlSeconds: number,
	loader: () => Promise<T>,
	options: { forceRefresh?: boolean } = {}
): Promise<T> {
	if (!options.forceRefresh) {
		const hit = getCached<T>(provider, key);
		if (hit !== null) return hit;
	}
	const fresh = await loader();
	setCached(provider, key, fresh, ttlSeconds);
	return fresh;
}

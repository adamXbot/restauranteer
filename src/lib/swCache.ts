export type CacheBreakdown = {
	name: string;
	entries: number;
	bytes: number;
};

export type CacheStats = {
	caches: CacheBreakdown[];
	totalEntries: number;
	totalBytes: number;
	supported: boolean;
};

const EMPTY: CacheStats = { caches: [], totalEntries: 0, totalBytes: 0, supported: false };

export async function measureCaches(): Promise<CacheStats> {
	if (typeof caches === 'undefined') return EMPTY;
	const names = await caches.keys();
	const breakdown: CacheBreakdown[] = [];
	for (const name of names) {
		const cache = await caches.open(name);
		const keys = await cache.keys();
		let bytes = 0;
		for (const req of keys) {
			const res = await cache.match(req);
			if (!res) continue;
			// Trust Content-Length when present — avoids materializing every image body.
			const cl = res.headers.get('Content-Length');
			const n = cl ? Number(cl) : NaN;
			if (Number.isFinite(n) && n > 0) {
				bytes += n;
				continue;
			}
			try {
				const blob = await res.blob();
				bytes += blob.size;
			} catch {
				/* opaque or unreadable — skip */
			}
		}
		breakdown.push({ name, entries: keys.length, bytes });
	}
	breakdown.sort((a, b) => b.bytes - a.bytes);
	return {
		caches: breakdown,
		totalEntries: breakdown.reduce((a, c) => a + c.entries, 0),
		totalBytes: breakdown.reduce((a, c) => a + c.bytes, 0),
		supported: true
	};
}

export async function deleteCache(name: string): Promise<boolean> {
	if (typeof caches === 'undefined') return false;
	return caches.delete(name);
}

export async function deleteAllCaches(): Promise<number> {
	if (typeof caches === 'undefined') return 0;
	const names = await caches.keys();
	let removed = 0;
	for (const name of names) {
		if (await caches.delete(name)) removed++;
	}
	return removed;
}

export function formatBytes(n: number): string {
	if (n <= 0) return '0 B';
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function prettyCacheName(name: string): string {
	if (name === 'photos') return 'Photos (Google Places)';
	if (name === 'restaurant-details') return 'Restaurant API';
	if (name === 'api-views') return 'List / Near / Search / Map';
	if (name === 'page-data') return 'Page data';
	if (name === 'attachments') return 'Vault attachments';
	if (name.startsWith('workbox-precache')) return 'App shell';
	if (name.startsWith('workbox-runtime')) return 'Runtime';
	return name;
}

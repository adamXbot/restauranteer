import { log } from '../../log';

const USER_AGENT =
	'Restauranteer/0.1 (+https://github.com/) personal-vault-tool fetches review pages for its sole operator';

const MIN_INTERVAL_MS = 1500;
// Some review sites (AGFG, certain SMH/Age pages) sit behind anti-bot edges
// that delay first-byte by 10-20s. 30s gives them headroom without leaving
// genuinely-dead requests hanging too long.
const FETCH_TIMEOUT_MS = 30_000;

type HostState = { lastRequest: number; pending: Promise<void> };
const hostState = new Map<string, HostState>();

/**
 * Rate-limited HTTP GET. Serializes requests per-host and waits at least
 * MIN_INTERVAL_MS between them. Returns the response body as text.
 */
export async function politeFetch(url: string): Promise<string> {
	const { text } = await politeFetchWithMeta(url);
	return text;
}

/**
 * Like politeFetch but also returns the response's final URL (after redirects).
 */
export async function politeFetchWithMeta(
	url: string
): Promise<{ text: string; finalUrl: string }> {
	const u = new URL(url);
	const key = u.host;

	const prev = hostState.get(key);
	let release!: () => void;
	const ours = new Promise<void>((r) => {
		release = r;
	});
	const wait = prev?.pending ?? Promise.resolve();
	hostState.set(key, { lastRequest: prev?.lastRequest ?? 0, pending: ours });

	try {
		await wait;
		const state = hostState.get(key);
		const last = state?.lastRequest ?? 0;
		const delay = Math.max(0, last + MIN_INTERVAL_MS - Date.now());
		if (delay > 0) await new Promise((r) => setTimeout(r, delay));

		log.debug('Scraper fetch', { url });
		const controller = new AbortController();
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, FETCH_TIMEOUT_MS);
		let text: string;
		let finalUrl: string;
		try {
			const res = await fetch(url, {
				headers: {
					'User-Agent': USER_AGENT,
					Accept: 'text/html,application/xhtml+xml',
					'Accept-Language': 'en-AU,en;q=0.9'
				},
				signal: controller.signal,
				redirect: 'follow'
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status} for ${url}`);
			}
			text = await res.text();
			finalUrl = res.url || url;
		} catch (e) {
			if (timedOut) {
				throw new Error(
					`Timed out after ${FETCH_TIMEOUT_MS / 1000}s waiting for ${u.host} (${url})`
				);
			}
			throw e;
		} finally {
			clearTimeout(timeout);
		}

		hostState.set(key, { lastRequest: Date.now(), pending: hostState.get(key)?.pending ?? ours });
		return { text, finalUrl };
	} finally {
		release();
	}
}

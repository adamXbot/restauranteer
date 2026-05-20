const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
const MAPS_HOSTS = new Set([
	'maps.app.goo.gl',
	'goo.gl',
	'maps.google.com',
	'maps.google.com.au',
	'www.google.com',
	'google.com'
]);

const PLACE_ID_RE = /^ChIJ[A-Za-z0-9_-]{20,}$/;
// Google's "data=" parameter on shared list URLs contains an !11m2!2s marker
// followed by the list ID. Place URLs use !3m / !4m markers instead.
const LIST_MARKER_RE = /!11m2!2s[A-Za-z0-9_-]+/;

export type ResolvedMapsTarget =
	| { kind: 'placeId'; placeId: string }
	| { kind: 'textQuery'; query: string; lat?: number; lng?: number }
	| { kind: 'failed'; reason: string };

export function isGoogleMapsUrl(rawUrl: string): boolean {
	try {
		const u = new URL(rawUrl);
		if (!MAPS_HOSTS.has(u.host)) return false;
		if (u.host === 'goo.gl' && !u.pathname.startsWith('/maps')) return false;
		// google.com / www.google.com need /maps in the path. The maps.google.com
		// subdomain is always maps regardless of path.
		if (
			(u.host === 'google.com' || u.host === 'www.google.com') &&
			!/^\/maps(\/|$|\?)/.test(u.pathname)
		) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

async function followRedirects(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, {
			method: 'GET',
			redirect: 'follow',
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
			}
		});
		return res.url;
	} catch {
		return null;
	}
}

export async function resolveMapsUrl(rawUrl: string): Promise<ResolvedMapsTarget> {
	let u: URL;
	try {
		u = new URL(rawUrl);
	} catch {
		return { kind: 'failed', reason: 'Invalid URL' };
	}

	if (SHORT_HOSTS.has(u.host)) {
		const resolved = await followRedirects(rawUrl);
		if (!resolved) return { kind: 'failed', reason: 'Short URL did not resolve' };
		try {
			u = new URL(resolved);
		} catch {
			return { kind: 'failed', reason: 'Resolved short URL is invalid' };
		}
	}

	// Direct place_id in query string
	const queryPid =
		u.searchParams.get('placeid') ??
		u.searchParams.get('place_id') ??
		u.searchParams.get('q')?.match(/place_id:([A-Za-z0-9_-]+)/)?.[1] ??
		null;
	if (queryPid && PLACE_ID_RE.test(queryPid)) {
		return { kind: 'placeId', placeId: queryPid };
	}

	// /maps/place/{name}/@{lat},{lng},...
	const placeWithCoords = u.pathname.match(
		/\/maps\/place\/([^/]+)\/@(-?\d+\.\d+),(-?\d+\.\d+)/
	);
	if (placeWithCoords) {
		const name = decodeURIComponent(placeWithCoords[1].replace(/\+/g, ' '));
		const lat = parseFloat(placeWithCoords[2]);
		const lng = parseFloat(placeWithCoords[3]);
		return { kind: 'textQuery', query: name, lat, lng };
	}

	// /maps/place/{name}
	const nameOnly = u.pathname.match(/\/maps\/place\/([^/]+)\/?$/);
	if (nameOnly) {
		const name = decodeURIComponent(nameOnly[1].replace(/\+/g, ' '));
		return { kind: 'textQuery', query: name };
	}

	// /maps/search/{query}
	const search = u.pathname.match(/\/maps\/search\/([^/]+)/);
	if (search) {
		const query = decodeURIComponent(search[1].replace(/\+/g, ' '));
		return { kind: 'textQuery', query };
	}

	// /maps?q=... (URL-encoded query)
	const qParam = u.searchParams.get('q');
	if (qParam && qParam.trim().length > 0 && !/^[\d.,\s-]+$/.test(qParam)) {
		return { kind: 'textQuery', query: qParam.trim() };
	}

	// CID-only URLs (?cid=12345)
	if (u.searchParams.get('cid')) {
		return {
			kind: 'failed',
			reason:
				'CID-only Google Maps URLs are not supported. Open the link in Google Maps, then use "Share" → "Send a link" and paste the full URL.'
		};
	}

	return {
		kind: 'failed',
		reason:
			'Could not extract a place from the URL. Try the desktop share URL (contains /place/{name}/...).'
	};
}

export type ResolvedMapsList = {
	kind: 'list';
	name: string;
	notes: string | null;
	icon: string | null;
	source_url: string;
	place_ids: string[];
};

export type ResolveMapsListResult =
	| ResolvedMapsList
	| { kind: 'not_a_list' }
	| { kind: 'failed'; reason: string };

/** A Google Maps URL is "list-shaped" when, after resolving shortlinks, the
 * canonical URL points at /maps/@ with a list-id marker in the data= param. */
export function isMapsListUrl(longUrl: string): boolean {
	try {
		const u = new URL(longUrl);
		if (!MAPS_HOSTS.has(u.host)) return false;
		if (!/^\/maps(\/|$)/.test(u.pathname)) return false;
		// Place URLs are /maps/place/...; lists are typically /maps/@... or /maps/?...
		if (/^\/maps\/place\//.test(u.pathname)) return false;
		const rawSearch = u.search;
		return LIST_MARKER_RE.test(rawSearch) || LIST_MARKER_RE.test(u.pathname);
	} catch {
		return false;
	}
}

function stripGoogleSuffix(title: string): string {
	return title
		.replace(/\s*[-–—|]\s*Google\s*Maps\s*$/i, '')
		.replace(/\s*[-–—|]\s*Google\s*$/i, '')
		.trim();
}

/** Pull `ChIJ...` place IDs out of the static HTML response. Best effort —
 * Google's list pages hydrate place data client-side, so this often returns
 * an empty list. When it does work it gives us a checklist to confirm. */
function extractPlaceIds(html: string): string[] {
	const matches = html.matchAll(/ChIJ[A-Za-z0-9_-]{20,}/g);
	const seen = new Set<string>();
	for (const m of matches) {
		const id = m[0];
		if (PLACE_ID_RE.test(id)) seen.add(id);
	}
	return Array.from(seen);
}

/**
 * Attempt to resolve a Google Maps list share URL. Returns the list's name
 * (always best-effort, from og:title), notes (og:description, sometimes a
 * generic summary), and any place IDs we could pull out of the static HTML.
 * Place ID extraction often returns []; that's OK — the user still gets a
 * named list to attach restaurants to manually.
 */
export async function resolveMapsList(rawUrl: string): Promise<ResolveMapsListResult> {
	let u: URL;
	try {
		u = new URL(rawUrl);
	} catch {
		return { kind: 'failed', reason: 'Invalid URL' };
	}

	let longUrl = rawUrl;
	if (SHORT_HOSTS.has(u.host)) {
		const resolved = await followRedirects(rawUrl);
		if (!resolved) return { kind: 'failed', reason: 'Short URL did not resolve' };
		longUrl = resolved;
	}

	if (!isMapsListUrl(longUrl)) {
		return { kind: 'not_a_list' };
	}

	let html: string;
	try {
		const r = await fetch(longUrl, {
			method: 'GET',
			redirect: 'follow',
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
				Accept: 'text/html,application/xhtml+xml'
			}
		});
		if (!r.ok) return { kind: 'failed', reason: `Google returned ${r.status}` };
		html = await r.text();
	} catch (e) {
		return { kind: 'failed', reason: `Network error: ${String(e)}` };
	}

	const ogTitleMatch = html.match(
		/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i
	);
	const ogDescMatch = html.match(
		/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']+)["']/i
	);
	const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);

	const rawName = (ogTitleMatch?.[1] ?? titleTagMatch?.[1] ?? '').trim();
	const name = stripGoogleSuffix(rawName);
	if (!name) {
		return { kind: 'failed', reason: 'Could not read list name from Google Maps' };
	}

	const notes = ogDescMatch?.[1]?.trim() || null;
	const place_ids = extractPlaceIds(html);

	return {
		kind: 'list',
		name,
		notes,
		icon: null,
		source_url: longUrl,
		place_ids
	};
}

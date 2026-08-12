/**
 * Apple Maps **Server API** search — the keyless-for-the-user lane, beside
 * Google's.
 *
 * The app already carries `APPLE_MAPKIT_*` credentials, but until now they
 * only minted MapKit JS *display* tokens: the map could render, and nothing
 * could be searched. The same Team ID / Key ID / private key drives the
 * Server API, so enabling search costs no new configuration.
 *
 * Auth is two-legged, unlike Google's single key:
 *   1. sign an ES256 JWT (team as issuer, key id in the header) — no `origin`
 *      claim, which is a MapKit-JS-only restriction and would be rejected here;
 *   2. exchange it at `/v1/token` for a short-lived access token, cached until
 *      shortly before it expires;
 *   3. call `/v1/search` with that access token.
 *
 * Results are filtered to the same food POI categories the iOS app's
 * `MKLocalSearch` lane uses, so the two peers surface comparable places.
 */
import { env } from '$env/dynamic/private';
import { SignJWT, importPKCS8 } from 'jose';
import { log } from '../log';

const BASE = 'https://maps-api.apple.com/v1';

/**
 * The plan's food-POI allowlist, in Apple's Server API spelling. Mirrors
 * `AppleMapsSearch.foodCategories` on iOS (`.restaurant, .cafe, .bakery,
 * .brewery, .winery, .distillery, .nightlife, .foodMarket`).
 */
export const FOOD_POI_CATEGORIES = [
	'Restaurant',
	'Cafe',
	'Bakery',
	'Brewery',
	'Winery',
	'Distillery',
	'Nightlife',
	'FoodMarket'
];

export type AppleSearchResult = {
	name: string;
	address: string | null;
	lat: number | null;
	lng: number | null;
	/** Apple's Place ID when the response carries one — see `place_ids.apple`. */
	place_id: string | null;
	category: string | null;
};

/** Signing credentials only — the static MapKit JS token cannot be exchanged. */
export function hasAppleSearch(): boolean {
	return !!(env.APPLE_MAPKIT_TEAM_ID && env.APPLE_MAPKIT_KEY_ID && env.APPLE_MAPKIT_PRIVATE_KEY);
}

type KeyLike = Awaited<ReturnType<typeof importPKCS8>>;
let cachedKey: KeyLike | null = null;

async function loadPrivateKey(): Promise<KeyLike> {
	if (cachedKey) return cachedKey;
	const raw = env.APPLE_MAPKIT_PRIVATE_KEY;
	if (!raw) throw new Error('APPLE_MAPKIT_PRIVATE_KEY not configured');
	// Allow either real newlines in the env or "\n" escape sequences.
	const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
	cachedKey = await importPKCS8(pem, 'ES256');
	return cachedKey;
}

let cachedAccess: { token: string; expiresAt: number } | null = null;

/** Exposed for tests; production callers use `appleSearchPlaces`. */
export function __resetAppleSearchCaches(): void {
	cachedKey = null;
	cachedAccess = null;
}

async function accessToken(fetchImpl: typeof fetch): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	// 60 s of slack so a token can't expire mid-flight.
	if (cachedAccess && cachedAccess.expiresAt - 60 > now) return cachedAccess.token;

	const key = await loadPrivateKey();
	// No `origin` claim: that restricts MapKit JS to a page, and the Server
	// API rejects tokens carrying it.
	const jwt = await new SignJWT({})
		.setProtectedHeader({ alg: 'ES256', kid: env.APPLE_MAPKIT_KEY_ID!, typ: 'JWT' })
		.setIssuer(env.APPLE_MAPKIT_TEAM_ID!)
		.setIssuedAt(now)
		.setExpirationTime(now + 60 * 30)
		.sign(key);

	const res = await fetchImpl(`${BASE}/token`, {
		headers: { Authorization: `Bearer ${jwt}` }
	});
	if (!res.ok) {
		throw new Error(`Apple token exchange failed (${res.status})`);
	}
	const body = (await res.json()) as { accessToken?: string; expiresInSeconds?: number };
	if (!body.accessToken) throw new Error('Apple token exchange returned no accessToken');

	cachedAccess = {
		token: body.accessToken,
		expiresAt: now + (body.expiresInSeconds ?? 60 * 30)
	};
	return cachedAccess.token;
}

/**
 * Search Apple Maps for food POIs. Returns `[]` — never throws — when the
 * credentials are absent or the call fails, so the vault and Google lanes
 * carry on regardless (the same tolerance the iOS lanes have).
 *
 * `fetchImpl` is injectable so tests can drive the two-leg auth without
 * network or credentials.
 */
export async function appleSearchPlaces(
	query: string,
	options: { lat?: number; lng?: number; limit?: number; fetchImpl?: typeof fetch } = {}
): Promise<AppleSearchResult[]> {
	const q = query.trim();
	if (!q || !hasAppleSearch()) return [];
	const fetchImpl = options.fetchImpl ?? fetch;

	try {
		const token = await accessToken(fetchImpl);
		const params = new URLSearchParams({
			q,
			resultTypeFilter: 'Poi',
			includePoiCategories: FOOD_POI_CATEGORIES.join(',')
		});
		if (Number.isFinite(options.lat) && Number.isFinite(options.lng)) {
			// Bias, not a hard filter — the same role the iOS completer's
			// region bias plays.
			params.set('searchLocation', `${options.lat},${options.lng}`);
		}
		if (options.limit) params.set('limit', String(options.limit));

		const res = await fetchImpl(`${BASE}/search?${params}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) {
			log.warn('Apple search failed', { status: res.status });
			return [];
		}
		const body = (await res.json()) as { results?: unknown[] };
		return (body.results ?? []).map(mapResult).filter((r): r is AppleSearchResult => r !== null);
	} catch (err) {
		log.warn('Apple search error', { error: String(err) });
		return [];
	}
}

type RawApplePlace = {
	name?: unknown;
	formattedAddressLines?: unknown;
	coordinate?: { latitude?: unknown; longitude?: unknown };
	poiCategory?: unknown;
	id?: unknown;
	placeId?: unknown;
};

/** One Apple result → the provider-neutral shape the search route returns. */
export function mapResult(raw: unknown): AppleSearchResult | null {
	const place = raw as RawApplePlace;
	const name = typeof place?.name === 'string' ? place.name.trim() : '';
	if (!name) return null;

	const lines = Array.isArray(place.formattedAddressLines)
		? place.formattedAddressLines.filter((l): l is string => typeof l === 'string')
		: [];
	// Apple's Place ID field has moved across API versions; accept either
	// spelling rather than silently dropping the id that makes an entry
	// cross-peer with the iOS app's `place_ids.apple`.
	const placeId =
		typeof place.id === 'string' && place.id
			? place.id
			: typeof place.placeId === 'string' && place.placeId
				? place.placeId
				: null;

	return {
		name,
		address: lines.length > 0 ? lines.join(', ') : null,
		lat: typeof place.coordinate?.latitude === 'number' ? place.coordinate.latitude : null,
		lng: typeof place.coordinate?.longitude === 'number' ? place.coordinate.longitude : null,
		place_id: placeId,
		category: typeof place.poiCategory === 'string' ? place.poiCategory : null
	};
}

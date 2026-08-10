/**
 * Apple Maps Server API search lane.
 *
 * The live call is NOT exercised here — that needs real Apple credentials and
 * a network. What is pinned is everything this repo owns: the two-leg auth
 * (JWT → access token, cached), the request shape, the food-category filter,
 * result mapping, and the never-throw contract the search route relies on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

type Modules = {
	appleSearch: typeof import('../../src/lib/server/providers/appleSearch');
};

let m: Modules;

/** A throwaway ES256 key, so signing is real rather than mocked. */
function makePrivateKeyPem(): string {
	const { privateKey } = generateKeyPairSync('ec', {
		namedCurve: 'P-256',
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' }
	});
	return privateKey as unknown as string;
}

beforeEach(async () => {
	process.env.APPLE_MAPKIT_TEAM_ID = 'TEAM123456';
	process.env.APPLE_MAPKIT_KEY_ID = 'KEY1234567';
	process.env.APPLE_MAPKIT_PRIVATE_KEY = makePrivateKeyPem();
	process.env.LOG_LEVEL = 'error';
	m = { appleSearch: await import('../../src/lib/server/providers/appleSearch') };
	m.appleSearch.__resetAppleSearchCaches();
});

afterEach(() => {
	delete process.env.APPLE_MAPKIT_TEAM_ID;
	delete process.env.APPLE_MAPKIT_KEY_ID;
	delete process.env.APPLE_MAPKIT_PRIVATE_KEY;
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
	return { ok, status, json: async () => body } as unknown as Response;
}

const ONE_RESULT = {
	results: [
		{
			name: 'Shandong Mama',
			formattedAddressLines: ['Shop 7, 200 Bourke St', 'Melbourne VIC 3000', 'Australia'],
			coordinate: { latitude: -37.8118, longitude: 144.9662 },
			poiCategory: 'Restaurant',
			id: 'IABCD1234'
		}
	]
};

describe('credentials gate', () => {
	it('needs signing credentials — a static MapKit JS token cannot be exchanged', async () => {
		expect(m.appleSearch.hasAppleSearch()).toBe(true);
		delete process.env.APPLE_MAPKIT_PRIVATE_KEY;
		expect(m.appleSearch.hasAppleSearch()).toBe(false);
		// And with none, the lane is silent rather than throwing.
		expect(await m.appleSearch.appleSearchPlaces('dumplings')).toEqual([]);
	});
});

describe('two-leg auth', () => {
	it('exchanges a signed JWT for an access token, then searches with it', async () => {
		const calls: { url: string; auth: string }[] = [];
		const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
			const u = String(url);
			calls.push({
				url: u,
				auth: String((init?.headers as Record<string, string>)?.Authorization ?? '')
			});
			if (u.includes('/v1/token')) {
				return jsonResponse({ accessToken: 'ACCESS-1', expiresInSeconds: 1800 });
			}
			return jsonResponse(ONE_RESULT);
		}) as unknown as typeof fetch;

		const results = await m.appleSearch.appleSearchPlaces('dumplings', { fetchImpl });

		expect(calls).toHaveLength(2);
		// Leg 1: a real ES256 JWT (three segments), not the access token.
		expect(calls[0].url).toContain('/v1/token');
		expect(calls[0].auth.replace('Bearer ', '').split('.')).toHaveLength(3);
		// Leg 2: the exchanged token.
		expect(calls[1].auth).toBe('Bearer ACCESS-1');
		expect(results).toHaveLength(1);
	});

	it('caches the access token across searches', async () => {
		let tokenCalls = 0;
		const fetchImpl = vi.fn(async (url: string | URL) => {
			if (String(url).includes('/v1/token')) {
				tokenCalls++;
				return jsonResponse({ accessToken: 'ACCESS-1', expiresInSeconds: 1800 });
			}
			return jsonResponse(ONE_RESULT);
		}) as unknown as typeof fetch;

		await m.appleSearch.appleSearchPlaces('a', { fetchImpl });
		await m.appleSearch.appleSearchPlaces('b', { fetchImpl });
		expect(tokenCalls).toBe(1);
	});

	it('re-exchanges once the cached token is near expiry', async () => {
		let tokenCalls = 0;
		const fetchImpl = vi.fn(async (url: string | URL) => {
			if (String(url).includes('/v1/token')) {
				tokenCalls++;
				// Inside the 60 s slack, so the next call must not reuse it.
				return jsonResponse({ accessToken: `ACCESS-${tokenCalls}`, expiresInSeconds: 30 });
			}
			return jsonResponse(ONE_RESULT);
		}) as unknown as typeof fetch;

		await m.appleSearch.appleSearchPlaces('a', { fetchImpl });
		await m.appleSearch.appleSearchPlaces('b', { fetchImpl });
		expect(tokenCalls).toBe(2);
	});
});

describe('request shape', () => {
	it('filters to food POI categories and biases by location', async () => {
		let searchUrl = '';
		const fetchImpl = vi.fn(async (url: string | URL) => {
			const u = String(url);
			if (u.includes('/v1/token')) {
				return jsonResponse({ accessToken: 'A', expiresInSeconds: 1800 });
			}
			searchUrl = u;
			return jsonResponse(ONE_RESULT);
		}) as unknown as typeof fetch;

		await m.appleSearch.appleSearchPlaces('dumplings', {
			lat: -37.81,
			lng: 144.96,
			limit: 8,
			fetchImpl
		});

		const params = new URL(searchUrl).searchParams;
		expect(params.get('q')).toBe('dumplings');
		expect(params.get('resultTypeFilter')).toBe('Poi');
		expect(params.get('searchLocation')).toBe('-37.81,144.96');
		expect(params.get('limit')).toBe('8');
		// The same allowlist the iOS MKLocalSearch lane uses.
		expect(params.get('includePoiCategories')?.split(',')).toEqual(
			m.appleSearch.FOOD_POI_CATEGORIES
		);
	});

	it('omits the location bias when coordinates are absent', async () => {
		let searchUrl = '';
		const fetchImpl = vi.fn(async (url: string | URL) => {
			if (String(url).includes('/v1/token')) {
				return jsonResponse({ accessToken: 'A', expiresInSeconds: 1800 });
			}
			searchUrl = String(url);
			return jsonResponse(ONE_RESULT);
		}) as unknown as typeof fetch;

		await m.appleSearch.appleSearchPlaces('dumplings', { fetchImpl });
		expect(new URL(searchUrl).searchParams.has('searchLocation')).toBe(false);
	});
});

describe('result mapping', () => {
	it('joins address lines and carries the Apple place id', () => {
		expect(m.appleSearch.mapResult(ONE_RESULT.results[0])).toEqual({
			name: 'Shandong Mama',
			address: 'Shop 7, 200 Bourke St, Melbourne VIC 3000, Australia',
			lat: -37.8118,
			lng: 144.9662,
			place_id: 'IABCD1234',
			category: 'Restaurant'
		});
	});

	it('accepts either id spelling — the field has moved across API versions', () => {
		expect(m.appleSearch.mapResult({ name: 'X', placeId: 'ALT-1' })?.place_id).toBe('ALT-1');
		expect(m.appleSearch.mapResult({ name: 'X' })?.place_id).toBeNull();
	});

	it('drops nameless results rather than surfacing a blank row', () => {
		expect(m.appleSearch.mapResult({ coordinate: { latitude: 1, longitude: 2 } })).toBeNull();
		expect(m.appleSearch.mapResult({ name: '   ' })).toBeNull();
	});
});

describe('never throws', () => {
	it('returns [] on a failed token exchange', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({}, false, 401)) as unknown as typeof fetch;
		expect(await m.appleSearch.appleSearchPlaces('x', { fetchImpl })).toEqual([]);
	});

	it('returns [] on a failed search and on a network error', async () => {
		const failSearch = vi.fn(async (url: string | URL) =>
			String(url).includes('/v1/token')
				? jsonResponse({ accessToken: 'A', expiresInSeconds: 1800 })
				: jsonResponse({}, false, 500)
		) as unknown as typeof fetch;
		expect(await m.appleSearch.appleSearchPlaces('x', { fetchImpl: failSearch })).toEqual([]);

		m.appleSearch.__resetAppleSearchCaches();
		const boom = vi.fn(async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		expect(await m.appleSearch.appleSearchPlaces('x', { fetchImpl: boom })).toEqual([]);
	});

	it('skips the call entirely for an empty query', async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		expect(await m.appleSearch.appleSearchPlaces('   ', { fetchImpl })).toEqual([]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

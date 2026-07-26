/**
 * Bearer-token guard. `$env/dynamic/private` is stubbed to `process.env` in
 * the vitest config, so each case sets the env vars it needs and the guard
 * reads them at call time.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
	authGuard,
	bearerToken,
	guardResponse,
	isApiPath,
	isSyncPath,
	requireAuthEverywhere,
	syncTokens,
	tokenMatches
} from '../../src/lib/server/sync/auth';

const SAVED = {
	token: process.env.RESTAURANTEER_SYNC_TOKEN,
	requireAuth: process.env.RESTAURANTEER_REQUIRE_AUTH
};

beforeEach(() => {
	delete process.env.RESTAURANTEER_SYNC_TOKEN;
	delete process.env.RESTAURANTEER_REQUIRE_AUTH;
});

afterEach(() => {
	if (SAVED.token === undefined) delete process.env.RESTAURANTEER_SYNC_TOKEN;
	else process.env.RESTAURANTEER_SYNC_TOKEN = SAVED.token;
	if (SAVED.requireAuth === undefined) delete process.env.RESTAURANTEER_REQUIRE_AUTH;
	else process.env.RESTAURANTEER_REQUIRE_AUTH = SAVED.requireAuth;
});

const bearer = (token: string) => `Bearer ${token}`;

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

describe('token configuration', () => {
	it('is empty when the env var is unset or blank', () => {
		expect(syncTokens()).toEqual([]);
		process.env.RESTAURANTEER_SYNC_TOKEN = '   ';
		expect(syncTokens()).toEqual([]);
	});

	it('parses a comma-separated list, trimming and dropping blanks', () => {
		process.env.RESTAURANTEER_SYNC_TOKEN = ' phone-token , ipad-token ,,laptop ';
		expect(syncTokens()).toEqual(['phone-token', 'ipad-token', 'laptop']);
	});

	it('reads RESTAURANTEER_REQUIRE_AUTH truthily', () => {
		expect(requireAuthEverywhere()).toBe(false);
		for (const value of ['1', 'true', 'YES']) {
			process.env.RESTAURANTEER_REQUIRE_AUTH = value;
			expect(requireAuthEverywhere(), value).toBe(true);
		}
		process.env.RESTAURANTEER_REQUIRE_AUTH = '0';
		expect(requireAuthEverywhere()).toBe(false);
	});
});

describe('tokenMatches', () => {
	it('matches any configured token and rejects everything else', () => {
		const allowed = ['phone-token', 'ipad-token'];
		expect(tokenMatches('phone-token', allowed)).toBe(true);
		expect(tokenMatches('ipad-token', allowed)).toBe(true);
		expect(tokenMatches('nope', allowed)).toBe(false);
		// Length differences must not throw — the digests are always 32 bytes.
		expect(tokenMatches('', allowed)).toBe(false);
		expect(tokenMatches('phone-token-with-extra', allowed)).toBe(false);
		expect(tokenMatches('phone-token', [])).toBe(false);
	});
});

describe('bearerToken', () => {
	it('extracts the token, case-insensitively on the scheme', () => {
		expect(bearerToken('Bearer abc123')).toBe('abc123');
		expect(bearerToken('bearer   abc123  ')).toBe('abc123');
		expect(bearerToken('BEARER\tabc123')).toBe('abc123');
	});

	it('rejects other schemes and malformed headers', () => {
		expect(bearerToken(null)).toBeNull();
		expect(bearerToken('')).toBeNull();
		expect(bearerToken('Basic abc123')).toBeNull();
		expect(bearerToken('Bearer')).toBeNull();
		expect(bearerToken('Bearer    ')).toBeNull();
		expect(bearerToken('abc123')).toBeNull();
	});
});

describe('path classification', () => {
	it('identifies the sync surface', () => {
		expect(isSyncPath('/api/sync')).toBe(true);
		expect(isSyncPath('/api/sync/info')).toBe(true);
		expect(isSyncPath('/api/sync/file')).toBe(true);
		expect(isSyncPath('/api/syncable')).toBe(false);
		expect(isSyncPath('/api/restaurants')).toBe(false);
	});

	it('identifies the API surface', () => {
		expect(isApiPath('/api/restaurants')).toBe(true);
		expect(isApiPath('/api')).toBe(true);
		expect(isApiPath('/health')).toBe(false);
		expect(isApiPath('/')).toBe(false);
	});
});

describe('guard — sync token unset', () => {
	it('answers 503 sync_disabled on /api/sync/*', async () => {
		const res = guardResponse('/api/sync/info', null);
		expect(res).not.toBeNull();
		expect(res!.status).toBe(503);
		expect(await bodyOf(res!)).toEqual({
			error: 'sync_disabled',
			message: 'Set RESTAURANTEER_SYNC_TOKEN to enable sync'
		});
	});

	it('answers 503 even when a token is presented', () => {
		expect(guardResponse('/api/sync/manifest', bearer('anything'))!.status).toBe(503);
	});

	it('leaves the rest of the API and the app untouched', () => {
		expect(guardResponse('/api/restaurants', null)).toBeNull();
		expect(guardResponse('/health', null)).toBeNull();
		expect(guardResponse('/', null)).toBeNull();
	});
});

describe('guard — sync token set', () => {
	beforeEach(() => {
		process.env.RESTAURANTEER_SYNC_TOKEN = 'phone-token,ipad-token';
	});

	it('lets a valid token through', () => {
		expect(guardResponse('/api/sync/info', bearer('phone-token'))).toBeNull();
		expect(guardResponse('/api/sync/file', bearer('ipad-token'))).toBeNull();
	});

	it('401s a missing, malformed or wrong token', async () => {
		for (const header of [null, 'Basic phone-token', 'Bearer', bearer('wrong-token')]) {
			const res = guardResponse('/api/sync/manifest', header);
			expect(res, String(header)).not.toBeNull();
			expect(res!.status, String(header)).toBe(401);
			expect(res!.headers.get('WWW-Authenticate')).toBe('Bearer realm="restauranteer"');
		}
		const res = guardResponse('/api/sync/manifest', null);
		expect((await bodyOf(res!)).error).toBe('unauthorized');
	});

	it('still leaves the rest of the API open by default', () => {
		expect(guardResponse('/api/restaurants', null)).toBeNull();
		expect(guardResponse('/api/search?q=x', null)).toBeNull();
	});
});

describe('guard — RESTAURANTEER_REQUIRE_AUTH=1', () => {
	beforeEach(() => {
		process.env.RESTAURANTEER_SYNC_TOKEN = 'phone-token';
		process.env.RESTAURANTEER_REQUIRE_AUTH = '1';
	});

	it('extends the requirement to every /api/* route', () => {
		expect(guardResponse('/api/restaurants', null)!.status).toBe(401);
		expect(guardResponse('/api/restaurants', bearer('phone-token'))).toBeNull();
		expect(guardResponse('/api/search', bearer('wrong'))!.status).toBe(401);
	});

	it('exempts /health and non-API routes', () => {
		expect(guardResponse('/health', null)).toBeNull();
		expect(guardResponse('/', null)).toBeNull();
		expect(guardResponse('/settings', null)).toBeNull();
	});

	it('fails closed when no token is configured', async () => {
		delete process.env.RESTAURANTEER_SYNC_TOKEN;
		const res = guardResponse('/api/restaurants', null);
		expect(res!.status).toBe(503);
		expect((await bodyOf(res!)).error).toBe('auth_misconfigured');
		// The sync surface keeps its own, more specific message.
		expect((await bodyOf(guardResponse('/api/sync/info', null)!)).error).toBe('sync_disabled');
	});
});

describe('authGuard handle', () => {
	function event(pathname: string, authorization?: string): RequestEvent {
		const url = new URL(pathname, 'http://localhost:3000');
		const headers = new Headers();
		if (authorization) headers.set('authorization', authorization);
		return { url, request: new Request(url, { headers }) } as unknown as RequestEvent;
	}

	const resolve = async () => new Response('resolved', { status: 200 });

	it('passes an authorised request to the handler', async () => {
		process.env.RESTAURANTEER_SYNC_TOKEN = 'phone-token';
		const res = await authGuard({
			event: event('/api/sync/info', bearer('phone-token')),
			resolve
		} as unknown as Parameters<typeof authGuard>[0]);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('resolved');
	});

	it('short-circuits an unauthorised request', async () => {
		process.env.RESTAURANTEER_SYNC_TOKEN = 'phone-token';
		const res = await authGuard({
			event: event('/api/sync/info'),
			resolve
		} as unknown as Parameters<typeof authGuard>[0]);
		expect(res.status).toBe(401);
	});

	it('short-circuits with 503 when sync is disabled', async () => {
		const res = await authGuard({
			event: event('/api/sync/manifest'),
			resolve
		} as unknown as Parameters<typeof authGuard>[0]);
		expect(res.status).toBe(503);
	});
});

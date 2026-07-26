/**
 * Bearer-token guard for the sync API.
 *
 * The app has no auth today and is documented "don't expose publicly", so the
 * guard is opt-in and fails *closed* on the sync surface:
 *
 *   - `RESTAURANTEER_SYNC_TOKEN` unset  → `/api/sync/*` answers 503. Sync is
 *     off; nothing is reachable without a deliberate opt-in.
 *   - set (comma-separated for several devices) → `/api/sync/*` requires
 *     `Authorization: Bearer <token>`.
 *   - `RESTAURANTEER_REQUIRE_AUTH=1` extends the same requirement to every
 *     `/api/*` route (except `/health`, which is not under `/api`). This locks
 *     out the browser UI's own fetches, so it is for headless deployments.
 *
 * Comparison is constant-time. Tokens are hashed first so `timingSafeEqual`
 * always sees equal-length buffers — comparing raw strings would leak length,
 * and `timingSafeEqual` throws on a mismatch.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { json, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const SYNC_PREFIX = '/api/sync';

/** Configured tokens, in order. Empty when sync is disabled. */
export function syncTokens(): string[] {
	const raw = env.RESTAURANTEER_SYNC_TOKEN ?? '';
	return raw
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

export function requireAuthEverywhere(): boolean {
	const raw = (env.RESTAURANTEER_REQUIRE_AUTH ?? '').trim().toLowerCase();
	return raw === '1' || raw === 'true' || raw === 'yes';
}

function digest(value: string): Buffer {
	return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time membership test — no early return on a match. */
export function tokenMatches(presented: string, allowed: string[]): boolean {
	if (allowed.length === 0) return false;
	const presentedDigest = digest(presented);
	let matched = false;
	for (const candidate of allowed) {
		if (timingSafeEqual(presentedDigest, digest(candidate))) matched = true;
	}
	return matched;
}

/** Extract the token from an `Authorization: Bearer …` header. */
export function bearerToken(header: string | null): string | null {
	if (!header) return null;
	const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
	if (!match) return null;
	const token = match[1].trim();
	return token.length > 0 ? token : null;
}

export function isSyncPath(pathname: string): boolean {
	return pathname === SYNC_PREFIX || pathname.startsWith(`${SYNC_PREFIX}/`);
}

export function isApiPath(pathname: string): boolean {
	return pathname === '/api' || pathname.startsWith('/api/');
}

function syncDisabled(): Response {
	return json(
		{ error: 'sync_disabled', message: 'Set RESTAURANTEER_SYNC_TOKEN to enable sync' },
		{ status: 503 }
	);
}

function unauthorized(): Response {
	return json(
		{ error: 'unauthorized', message: 'Authorization: Bearer <token> required' },
		{ status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="restauranteer"' } }
	);
}

function authMisconfigured(): Response {
	return json(
		{
			error: 'auth_misconfigured',
			message: 'RESTAURANTEER_REQUIRE_AUTH=1 also requires RESTAURANTEER_SYNC_TOKEN'
		},
		{ status: 503 }
	);
}

/**
 * Decide the guard's response for a request, or null to let it through.
 * Separated from the `Handle` wrapper so it can be exercised directly.
 */
export function guardResponse(pathname: string, authorization: string | null): Response | null {
	const tokens = syncTokens();

	if (isSyncPath(pathname)) {
		if (tokens.length === 0) return syncDisabled();
		const presented = bearerToken(authorization);
		if (!presented || !tokenMatches(presented, tokens)) return unauthorized();
		return null;
	}

	if (!requireAuthEverywhere()) return null;
	if (pathname === '/health' || !isApiPath(pathname)) return null;
	// Fail closed: an operator who asked for auth everywhere but configured no
	// token gets a loud 503, not a silently open API.
	if (tokens.length === 0) return authMisconfigured();
	const presented = bearerToken(authorization);
	if (!presented || !tokenMatches(presented, tokens)) return unauthorized();
	return null;
}

export const authGuard: Handle = async ({ event, resolve }) => {
	const blocked = guardResponse(event.url.pathname, event.request.headers.get('authorization'));
	if (blocked) return blocked;
	return resolve(event);
};

import { env } from '$env/dynamic/private';
import { SignJWT, importPKCS8 } from 'jose';
import { log } from '../log';

function hasSigningKey(): boolean {
	return !!(env.APPLE_MAPKIT_TEAM_ID && env.APPLE_MAPKIT_KEY_ID && env.APPLE_MAPKIT_PRIVATE_KEY);
}

function hasStaticToken(): boolean {
	return !!env.APPLE_MAPKIT_TOKEN && env.APPLE_MAPKIT_TOKEN.trim().split('.').length === 3;
}

export function hasAppleMapKit(): boolean {
	return hasSigningKey() || hasStaticToken();
}

let cachedKey: CryptoKey | KeyLike | null = null;
type KeyLike = Awaited<ReturnType<typeof importPKCS8>>;

async function loadPrivateKey(): Promise<KeyLike> {
	if (cachedKey) return cachedKey as KeyLike;
	const raw = env.APPLE_MAPKIT_PRIVATE_KEY;
	if (!raw) throw new Error('APPLE_MAPKIT_PRIVATE_KEY not configured');
	// Allow either real newlines in the env or "\n" escape sequences.
	const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
	const key = await importPKCS8(pem, 'ES256');
	cachedKey = key;
	return key;
}

let cachedToken: { token: string; expiresAt: number; origin?: string } | null = null;
const TOKEN_TTL_SECONDS = 60 * 30; // 30 min (Apple allows up to 1 year, we keep short)

let staticTokenExpiryWarned = false;

function parseJwtExp(token: string): number | null {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	try {
		const payload = JSON.parse(
			Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
		) as { exp?: unknown };
		return typeof payload.exp === 'number' ? payload.exp : null;
	} catch {
		return null;
	}
}

/**
 * Return a MapKit JS Authorization JWT. Two paths:
 *   1. `APPLE_MAPKIT_TOKEN` set — return that pre-signed JWT directly (the
 *      Apple Quickstart-portal flow). Time-limited; user must rotate manually.
 *   2. `APPLE_MAPKIT_TEAM_ID` + `KEY_ID` + `PRIVATE_KEY` set — sign a fresh
 *      JWT here, cached for ~30 min.
 * The static-token path takes precedence when both are set.
 *
 * `requestOrigin` is used as the JWT `origin` claim for the signing path when
 * `APPLE_MAPKIT_ORIGIN` is not set — required for domain-restricted MapKit keys,
 * which reject a token whose origin doesn't match the page exactly.
 */
export async function getMapKitToken(requestOrigin?: string): Promise<string> {
	if (!hasAppleMapKit()) {
		throw new Error('Apple MapKit JS is not configured');
	}

	if (hasStaticToken()) {
		const token = env.APPLE_MAPKIT_TOKEN!.trim();
		const exp = parseJwtExp(token);
		if (exp != null) {
			const secondsLeft = exp - Math.floor(Date.now() / 1000);
			if (secondsLeft <= 0) {
				log.error('APPLE_MAPKIT_TOKEN has expired — regenerate at developer.apple.com/maps/');
			} else if (secondsLeft < 60 * 60 * 24 * 7 && !staticTokenExpiryWarned) {
				log.warn('APPLE_MAPKIT_TOKEN expires soon', {
					days_left: Math.round(secondsLeft / 86400)
				});
				staticTokenExpiryWarned = true;
			}
		}
		return token;
	}

	// Domain-restricted keys require the token's `origin` claim to match the
	// page origin exactly. Prefer an explicit env value (reliable behind a
	// reverse proxy, where a derived origin can be wrong); else use the origin
	// passed from the request. Omitting it leaves the token unrestricted.
	const origin = env.APPLE_MAPKIT_ORIGIN?.trim() || requestOrigin || undefined;

	const now = Math.floor(Date.now() / 1000);
	if (cachedToken && cachedToken.expiresAt - 60 > now && cachedToken.origin === origin) {
		return cachedToken.token;
	}

	try {
		const key = await loadPrivateKey();
		const expiresAt = now + TOKEN_TTL_SECONDS;
		const token = await new SignJWT(origin ? { origin } : {})
			.setProtectedHeader({ alg: 'ES256', kid: env.APPLE_MAPKIT_KEY_ID!, typ: 'JWT' })
			.setIssuer(env.APPLE_MAPKIT_TEAM_ID!)
			.setIssuedAt(now)
			.setExpirationTime(expiresAt)
			.sign(key);
		cachedToken = { token, expiresAt, origin };
		return token;
	} catch (e) {
		log.error('MapKit token sign failed', { error: String(e) });
		throw e;
	}
}

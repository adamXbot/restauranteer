import { env } from '$env/dynamic/private';
import { SignJWT, importPKCS8 } from 'jose';
import { log } from '../log';

export function hasAppleMapKit(): boolean {
	return !!(env.APPLE_MAPKIT_TEAM_ID && env.APPLE_MAPKIT_KEY_ID && env.APPLE_MAPKIT_PRIVATE_KEY);
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

let cachedToken: { token: string; expiresAt: number } | null = null;
const TOKEN_TTL_SECONDS = 60 * 30; // 30 min (Apple allows up to 1 year, we keep short)

/**
 * Sign a MapKit JS Authorization JWT. Cached for ~30 min.
 */
export async function getMapKitToken(): Promise<string> {
	if (!hasAppleMapKit()) {
		throw new Error('Apple MapKit JS is not configured');
	}
	const now = Math.floor(Date.now() / 1000);
	if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.token;

	try {
		const key = await loadPrivateKey();
		const expiresAt = now + TOKEN_TTL_SECONDS;
		const token = await new SignJWT({})
			.setProtectedHeader({ alg: 'ES256', kid: env.APPLE_MAPKIT_KEY_ID!, typ: 'JWT' })
			.setIssuer(env.APPLE_MAPKIT_TEAM_ID!)
			.setIssuedAt(now)
			.setExpirationTime(expiresAt)
			.sign(key);
		cachedToken = { token, expiresAt };
		return token;
	} catch (e) {
		log.error('MapKit token sign failed', { error: String(e) });
		throw e;
	}
}

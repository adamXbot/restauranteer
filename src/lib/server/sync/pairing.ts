/**
 * The pairing code the iOS app scans, and the rules for producing one.
 *
 * The payload is a bare JSON object, **not a URL**:
 *
 *     {"v":1,"url":"https://vault.example.ts.net","token":"…"}
 *
 * A `restauranteer://pair?token=…` code would be the obvious design, but a
 * registered pairing scheme lets any web page deep-link someone into pairing
 * with an attacker's server. Codes are scanned in-app only, and this payload
 * is inert to the system camera, Safari and every other scanner — there is
 * nothing in it to open. Mirrored by `PairingPayload` in the iOS repo.
 */
import QRCode from 'qrcode';

export const PAIRING_VERSION = 1;

export type PairingPayload = { v: number; url: string; token: string };

export type UrlProblem = 'empty' | 'unparseable' | 'not_https';

/**
 * Whether an address is one the phone can actually use.
 *
 * The app refuses `http://` outright (ATS blocks cleartext and per-host
 * exceptions can't be added from Settings), so encoding one into a QR would
 * produce a code that scans and then fails. Caught here instead.
 */
export function checkPairingUrl(raw: string): { ok: true; url: string } | { ok: false; problem: UrlProblem } {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, problem: 'empty' };

	let parsed: URL;
	try {
		parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
	} catch {
		return { ok: false, problem: 'unparseable' };
	}
	if (parsed.protocol !== 'https:') return { ok: false, problem: 'not_https' };
	if (!parsed.hostname) return { ok: false, problem: 'unparseable' };

	// The app appends /api/sync/… to this, so a trailing slash or a path would
	// double up. Origin only.
	return { ok: true, url: parsed.origin };
}

export function urlProblemMessage(problem: UrlProblem): string {
	switch (problem) {
		case 'empty':
			return 'Enter the address your phone should use, for example https://vault.tail1234.ts.net';
		case 'unparseable':
			return "That doesn't look like a web address.";
		case 'not_https':
			return 'The app only connects over HTTPS, so a pairing code has to carry an https:// address.';
	}
}

/**
 * Is this an address the *phone* can reach, or just one this browser can?
 *
 * The common trap: the operator opens the app at `http://localhost:3000` or a
 * LAN IP, generates a code, and the phone can't use it. Not an error — the
 * address may be reachable and simply not be where the browser is — so it is
 * surfaced as a caution rather than a refusal.
 */
export function looksLocalOnly(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
	if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
	return /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export function pairingPayload(url: string, token: string): PairingPayload {
	return { v: PAIRING_VERSION, url, token };
}

/** SVG so the code renders without shipping the token through an <img> URL. */
export async function pairingQrSvg(payload: PairingPayload): Promise<string> {
	return QRCode.toString(JSON.stringify(payload), {
		type: 'svg',
		// Q tolerates ~25% damage — a phone camera reading a screen at an
		// angle, which is the whole use case.
		errorCorrectionLevel: 'Q',
		margin: 1,
		width: 320
	});
}

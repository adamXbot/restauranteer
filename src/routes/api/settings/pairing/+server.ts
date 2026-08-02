/**
 * Produces the QR code the iOS app scans to pair with this server.
 *
 * POST-only and never part of the settings page load, because the response
 * contains a **credential**: `RESTAURANTEER_SYNC_TOKEN` in the clear. The page
 * asks for it only when the operator taps "Show pairing code", so the token is
 * not sitting in the HTML of a page that might be left open on a screen.
 *
 * That is the limit of the protection, and it is worth being plain about: the
 * browser UI has no auth of its own, so anyone who can open this app can reveal
 * the token and pair a device. That is the app's documented posture ("don't
 * expose publicly"). A deployment that needs more sets
 * `RESTAURANTEER_REQUIRE_AUTH=1`, which puts this endpoint behind the same
 * bearer token as the rest of `/api`.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncTokens } from '$lib/server/sync/auth';
import {
	checkPairingUrl,
	looksLocalOnly,
	pairingPayload,
	pairingQrSvg,
	urlProblemMessage
} from '$lib/server/sync/pairing';

export const POST: RequestHandler = async ({ request, url: requestUrl }) => {
	const tokens = syncTokens();
	if (tokens.length === 0) {
		throw error(503, 'Sync is off. Set RESTAURANTEER_SYNC_TOKEN and restart to pair a device.');
	}

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

	// Which configured token to encode. RESTAURANTEER_SYNC_TOKEN is
	// comma-separated precisely so each device can have its own, so the
	// operator picks; the first is the default.
	const rawIndex = body?.index;
	const index = typeof rawIndex === 'number' && Number.isInteger(rawIndex) ? rawIndex : 0;
	if (index < 0 || index >= tokens.length) throw error(400, 'no such token');

	// The address the *phone* should use, which is often not where this
	// browser is (localhost, a LAN IP). Defaults to this request's origin.
	const rawUrl = typeof body?.url === 'string' && body.url.trim() ? body.url : requestUrl.origin;
	const checked = checkPairingUrl(rawUrl);
	if (!checked.ok) throw error(400, urlProblemMessage(checked.problem));

	const token = tokens[index];
	const payload = pairingPayload(checked.url, token);

	return json({
		url: checked.url,
		token,
		svg: await pairingQrSvg(payload),
		localOnly: looksLocalOnly(new URL(checked.url).hostname)
	});
};

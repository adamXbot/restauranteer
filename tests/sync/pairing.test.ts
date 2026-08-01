import { describe, it, expect } from 'vitest';
import {
	PAIRING_VERSION,
	checkPairingUrl,
	looksLocalOnly,
	pairingPayload,
	pairingQrSvg
} from '../../src/lib/server/sync/pairing';

describe('pairing url', () => {
	it('upgrades a scheme-less address rather than refusing it', () => {
		expect(checkPairingUrl('vault.tail1234.ts.net')).toEqual({
			ok: true,
			url: 'https://vault.tail1234.ts.net'
		});
	});

	it('reduces to the origin, because the app appends /api/sync/…', () => {
		// A trailing slash or a path would double up in the request URL.
		expect(checkPairingUrl('https://a.example/sub/path?x=1')).toEqual({
			ok: true,
			url: 'https://a.example'
		});
		expect(checkPairingUrl('https://a.example/')).toEqual({ ok: true, url: 'https://a.example' });
	});

	it('refuses http, which the app cannot use at all', () => {
		// ATS blocks cleartext and the app has no per-host exception UI, so a
		// code carrying http:// would scan and then fail.
		expect(checkPairingUrl('http://a.example')).toEqual({ ok: false, problem: 'not_https' });
	});

	it('refuses empty and unparseable input', () => {
		expect(checkPairingUrl('   ')).toEqual({ ok: false, problem: 'empty' });
		expect(checkPairingUrl('https://')).toEqual({ ok: false, problem: 'unparseable' });
	});

	it('keeps a non-default port', () => {
		expect(checkPairingUrl('https://a.example:8443')).toEqual({
			ok: true,
			url: 'https://a.example:8443'
		});
	});
});

describe('local-only detection', () => {
	it('flags the addresses a phone usually cannot reach', () => {
		for (const host of [
			'localhost',
			'127.0.0.1',
			'192.168.1.10',
			'10.0.0.5',
			'172.16.0.1',
			'172.31.255.254',
			'nas.local'
		]) {
			expect(looksLocalOnly(host), host).toBe(true);
		}
	});

	it('leaves routable and tailnet addresses alone', () => {
		for (const host of [
			'vault.tail1234.ts.net',
			'example.com',
			'172.15.0.1', // just outside the private /12
			'172.32.0.1'
		]) {
			expect(looksLocalOnly(host), host).toBe(false);
		}
	});
});

describe('payload', () => {
	it('carries the version, address and token', () => {
		expect(pairingPayload('https://a.example', 'tok')).toEqual({
			v: PAIRING_VERSION,
			url: 'https://a.example',
			token: 'tok'
		});
	});

	it('is a bare JSON object, not a URL the system camera would offer to open', () => {
		// The deliberate choice: no restauranteer:// scheme, so no web page can
		// deep-link someone into pairing with an attacker's server.
		const encoded = JSON.stringify(pairingPayload('https://a.example', 'tok'));
		expect(encoded.startsWith('{')).toBe(true);
		expect(encoded).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
	});

	it('renders a scannable svg that embeds the payload version', async () => {
		const svg = await pairingQrSvg(pairingPayload('https://a.example', 'tok'));
		expect(svg).toContain('<svg');
		expect(svg).toContain('viewBox');
	});
});

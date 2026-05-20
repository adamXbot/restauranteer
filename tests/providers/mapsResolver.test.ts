import { describe, expect, it } from 'vitest';
import { isGoogleMapsUrl, resolveMapsUrl } from '../../src/lib/server/providers/mapsResolver';

describe('isGoogleMapsUrl', () => {
	it('accepts canonical google.com/maps URLs', () => {
		expect(
			isGoogleMapsUrl('https://www.google.com/maps/place/Cumulus+Inc/@-37.8,144.9,17z')
		).toBe(true);
	});
	it('accepts maps.google.com', () => {
		expect(isGoogleMapsUrl('https://maps.google.com/?cid=12345')).toBe(true);
	});
	it('accepts short URLs', () => {
		expect(isGoogleMapsUrl('https://maps.app.goo.gl/AbCdEf')).toBe(true);
		expect(isGoogleMapsUrl('https://goo.gl/maps/AbCdEf')).toBe(true);
	});
	it('rejects goo.gl non-maps', () => {
		expect(isGoogleMapsUrl('https://goo.gl/abcde')).toBe(false);
	});
	it('rejects non-Google URLs', () => {
		expect(isGoogleMapsUrl('https://www.broadsheet.com.au/melbourne/restaurants/x')).toBe(false);
		expect(isGoogleMapsUrl('not a url')).toBe(false);
	});
	it('rejects google.com without /maps', () => {
		expect(isGoogleMapsUrl('https://www.google.com/search?q=cumulus')).toBe(false);
	});
});

describe('resolveMapsUrl', () => {
	it('extracts a place_id query param when present', async () => {
		const r = await resolveMapsUrl(
			'https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4'
		);
		expect(r.kind).toBe('placeId');
		if (r.kind === 'placeId') expect(r.placeId).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
	});
	it('parses /place/{name}/@{lat},{lng}', async () => {
		const r = await resolveMapsUrl(
			'https://www.google.com/maps/place/Cumulus+Inc/@-37.8158,144.9685,17z/data=!3m1!4b1'
		);
		expect(r.kind).toBe('textQuery');
		if (r.kind === 'textQuery') {
			expect(r.query).toBe('Cumulus Inc');
			expect(r.lat).toBeCloseTo(-37.8158);
			expect(r.lng).toBeCloseTo(144.9685);
		}
	});
	it('parses /place/{name} with no coords', async () => {
		const r = await resolveMapsUrl('https://www.google.com/maps/place/Cumulus+Inc');
		expect(r.kind).toBe('textQuery');
		if (r.kind === 'textQuery') {
			expect(r.query).toBe('Cumulus Inc');
			expect(r.lat).toBeUndefined();
		}
	});
	it('parses ?q= text', async () => {
		const r = await resolveMapsUrl('https://www.google.com/maps?q=Cumulus+Inc+Flinders+Lane');
		expect(r.kind).toBe('textQuery');
		if (r.kind === 'textQuery') expect(r.query).toBe('Cumulus Inc Flinders Lane');
	});
	it('rejects CID-only URLs with a clear message', async () => {
		const r = await resolveMapsUrl('https://maps.google.com/?cid=12345');
		expect(r.kind).toBe('failed');
		if (r.kind === 'failed') expect(r.reason).toMatch(/CID/i);
	});
});

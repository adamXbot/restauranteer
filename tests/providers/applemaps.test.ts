import { describe, expect, it } from 'vitest';
import { applemaps, extractBusinessEntity } from '../../src/lib/server/providers/scraper/applemaps';

describe('applemaps.matchesUrl', () => {
	it('accepts share short URLs', () => {
		expect(applemaps.matchesUrl('https://maps.apple/p/rWWPeqp1QDFquo')).toBe(true);
	});

	it('accepts canonical place URLs', () => {
		expect(
			applemaps.matchesUrl(
				'https://maps.apple.com/place?address=324%20Bridge%20Rd&coordinate=-37.819,145.002&name=Laikon&place-id=I2073E3C64C8FCFB0'
			)
		).toBe(true);
	});

	it('accepts legacy query-string URLs', () => {
		expect(applemaps.matchesUrl('https://maps.apple.com/?q=Cumulus&ll=-37.8,145')).toBe(true);
	});

	it('accepts the beta host', () => {
		expect(applemaps.matchesUrl('https://beta.maps.apple.com/?q=anything')).toBe(true);
	});

	it('rejects non-Apple Maps URLs', () => {
		expect(applemaps.matchesUrl('https://maps.google.com/?q=Cumulus')).toBe(false);
		expect(applemaps.matchesUrl('https://maps.apple/something-else')).toBe(false);
		expect(applemaps.matchesUrl('https://www.broadsheet.com.au/melbourne')).toBe(false);
	});
});

describe('extractBusinessEntity', () => {
	it('pulls phone, website, and categories out of the embedded JSON blob', () => {
		const html =
			'<html>…' +
			'"entity":{"type":"BUSINESS","telephone":"+61394288495",' +
			'"url":"http://www.laikondeli.com.au",' +
			'"name":[{"locale":"en-AU","stringValue":"Laikon Delicatessen"}],' +
			'"localizedCategory":[' +
			'{"level":1,"localizedName":[{"locale":"en-AU","stringValue":"Dining"}]},' +
			'{"level":2,"localizedName":[{"locale":"en-AU","stringValue":"Deli"}]},' +
			'{"level":2,"localizedName":[{"locale":"en-AU","stringValue":"Cafe"}]}' +
			']}';
		const result = extractBusinessEntity(html);
		expect(result.phone).toBe('+61394288495');
		expect(result.website).toBe('http://www.laikondeli.com.au');
		// "Dining" is the level-1 umbrella — filtered out as too generic.
		expect(result.categories).toEqual(['Deli', 'Cafe']);
	});

	it('returns nulls when the BUSINESS entity is absent', () => {
		expect(extractBusinessEntity('<html>nothing here</html>')).toEqual({
			phone: null,
			website: null,
			categories: []
		});
	});

	it('rejects non-http website values', () => {
		const html =
			'"type":"BUSINESS","telephone":"+1","url":"javascript:void(0)","name":[{"locale":"en","stringValue":"X"}]';
		const result = extractBusinessEntity(html);
		expect(result.website).toBeNull();
		expect(result.phone).toBe('+1');
	});
});

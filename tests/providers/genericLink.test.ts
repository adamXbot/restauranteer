import { describe, expect, it } from 'vitest';
import { detectLinkSource } from '../../src/lib/server/providers/scraper/genericLink';

describe('detectLinkSource', () => {
	it('recognises known publication and social hostnames', () => {
		expect(detectLinkSource('https://www.timeout.com/melbourne/restaurants/example').source).toBe(
			'timeout'
		);
		expect(detectLinkSource('https://www.instagram.com/p/abc123/').source).toBe('instagram');
		expect(detectLinkSource('https://www.tiktok.com/@user/video/72839472'.replace(/'/g, '')).source).toBe(
			'tiktok'
		);
		expect(detectLinkSource('https://vt.tiktok.com/ABC123/').source).toBe('tiktok');
		expect(detectLinkSource('https://www.reddit.com/r/MelbourneFood/comments/abc/').source).toBe(
			'reddit'
		);
		expect(detectLinkSource('https://redd.it/abc123').source).toBe('reddit');
		expect(
			detectLinkSource('https://www.tripadvisor.com.au/Restaurant_Review-g255100.html').source
		).toBe('tripadvisor');
		expect(detectLinkSource('https://youtu.be/dQw4w9WgXcQ').source).toBe('youtube');
	});

	it('returns a hostname-derived slug for unknown hosts', () => {
		const r = detectLinkSource('https://www.foursquare.com/v/some-place/abc');
		expect(r.source).toBe('foursquare');
		expect(r.label).toBe('Foursquare');
	});

	it('returns a sensible default for malformed URLs', () => {
		const r = detectLinkSource('not a url at all');
		expect(r.source).toBe('link');
	});

	it('uses friendly labels for known hosts', () => {
		expect(detectLinkSource('https://timeout.com/x').label).toBe('Time Out');
		expect(detectLinkSource('https://tripadvisor.com.au/x').label).toBe('TripAdvisor');
		expect(detectLinkSource('https://reddit.com/x').label).toBe('Reddit');
	});
});

import { describe, expect, it } from 'vitest';
import {
	broadsheet,
	extractContactDetailsFromHydration,
	parseSuburbsFromDirectoryHtml
} from '../../src/lib/server/providers/scraper/broadsheet';

describe('broadsheet.matchesUrl', () => {
	it('accepts news article URLs', () => {
		expect(
			broadsheet.matchesUrl(
				'https://www.broadsheet.com.au/melbourne/food-and-drink/article/dingo-ate-my-taco-abbotsford-restaurant-opening-winter-2026'
			)
		).toBe(true);
	});

	it('accepts legacy directory URLs (no suburb)', () => {
		expect(broadsheet.matchesUrl('https://www.broadsheet.com.au/melbourne/restaurants/cumulus-inc')).toBe(true);
		expect(broadsheet.matchesUrl('https://www.broadsheet.com.au/melbourne/cafes/seven-seeds')).toBe(true);
		expect(broadsheet.matchesUrl('https://www.broadsheet.com.au/melbourne/bars/bar-margaux')).toBe(true);
	});

	it('accepts canonical directory URLs with suburb', () => {
		expect(
			broadsheet.matchesUrl('https://www.broadsheet.com.au/melbourne/box-hill/cafes/second-wife')
		).toBe(true);
		expect(
			broadsheet.matchesUrl('https://www.broadsheet.com.au/sydney/surry-hills/restaurants/poly')
		).toBe(true);
		expect(
			broadsheet.matchesUrl('https://www.broadsheet.com.au/melbourne/fitzroy/bars/old-palm-liquor')
		).toBe(true);
	});

	it('rejects non-Broadsheet URLs', () => {
		expect(broadsheet.matchesUrl('https://www.goodfood.com.au/whatever')).toBe(false);
		expect(broadsheet.matchesUrl('https://example.com/restaurants/x')).toBe(false);
	});

	it('rejects Broadsheet URLs that are not articles or directory entries', () => {
		expect(broadsheet.matchesUrl('https://www.broadsheet.com.au/melbourne')).toBe(false);
		expect(broadsheet.matchesUrl('https://www.broadsheet.com.au/melbourne/directory')).toBe(false);
		expect(broadsheet.matchesUrl('https://www.broadsheet.com.au/melbourne/box-hill')).toBe(false);
		expect(broadsheet.matchesUrl('https://www.broadsheet.com.au/melbourne/guides/best-bars-brunswick')).toBe(
			false
		);
	});
});

describe('extractContactDetailsFromHydration', () => {
	// Broadsheet renders the venue's phone/website inside a "Contact Details" h3
	// accordion that's hydrated client-side from a Next.js streaming chunk. We
	// scrape the chunk directly because the rendered <div> is empty in the
	// static HTML.
	it('pulls the business website out of the streaming chunk', () => {
		const html =
			'<html>…<script>self.__next_f.push([1,"41:[\\"$\\",\\"$L4f\\",null,' +
			'{\\"phone\\":\\"(03) 9650 1445\\",\\"website\\":\\"http://www.cumulusinc.com.au/\\",' +
			'\\"title\\":\\"Cumulus Inc.\\",\\"region\\":\\"Melbourne\\"}]\\n"])</script>…</html>';
		expect(extractContactDetailsFromHydration(html)).toEqual({
			phone: '(03) 9650 1445',
			website: 'http://www.cumulusinc.com.au/'
		});
	});

	it('returns nulls when the contact details payload is absent', () => {
		expect(extractContactDetailsFromHydration('<html>nothing here</html>')).toEqual({
			phone: null,
			website: null
		});
	});

	it('drops non-http website values', () => {
		const html =
			'<script>self.__next_f.push([1,"x:[{\\"phone\\":\\"\\",\\"website\\":\\"javascript:void(0)\\",' +
			'\\"title\\":\\"X\\",\\"region\\":\\"Y\\"}]"])</script>';
		expect(extractContactDetailsFromHydration(html).website).toBeNull();
	});
});

describe('parseSuburbsFromDirectoryHtml', () => {
	it('extracts suburb slugs from /{city}/{slug} hrefs', () => {
		const html = `<html><body>
			<a href="/melbourne/abbotsford">Abbotsford</a>
			<a href="/melbourne/box-hill">Box Hill</a>
			<a href="https://www.broadsheet.com.au/melbourne/carlton">Carlton</a>
			<a href="/melbourne/south-yarra/">South Yarra</a>
		</body></html>`;
		const result = parseSuburbsFromDirectoryHtml('melbourne', html);
		expect(result).toEqual([
			{ slug: 'abbotsford', label: 'Abbotsford' },
			{ slug: 'box-hill', label: 'Box Hill' },
			{ slug: 'carlton', label: 'Carlton' },
			{ slug: 'south-yarra', label: 'South Yarra' }
		]);
	});

	it('rejects non-suburb path segments', () => {
		const html = `<html><body>
			<a href="/melbourne/abbotsford">Abbotsford</a>
			<a href="/melbourne/restaurants">Restaurants directory</a>
			<a href="/melbourne/cafes">Cafes directory</a>
			<a href="/melbourne/food-and-drink">Editorial section</a>
			<a href="/melbourne/directory">Directory home</a>
			<a href="/melbourne">City home</a>
		</body></html>`;
		const result = parseSuburbsFromDirectoryHtml('melbourne', html);
		expect(result.map((s) => s.slug)).toEqual(['abbotsford']);
	});

	it('deduplicates repeated suburb links', () => {
		const html = `<html><body>
			<a href="/sydney/bondi">Bondi</a>
			<a href="/sydney/bondi">Bondi (again)</a>
		</body></html>`;
		const result = parseSuburbsFromDirectoryHtml('sydney', html);
		expect(result).toEqual([{ slug: 'bondi', label: 'Bondi' }]);
	});

	it('ignores hrefs from other cities', () => {
		const html = `<html><body>
			<a href="/melbourne/fitzroy">Fitzroy</a>
			<a href="/sydney/redfern">Redfern</a>
		</body></html>`;
		const result = parseSuburbsFromDirectoryHtml('melbourne', html);
		expect(result.map((s) => s.slug)).toEqual(['fitzroy']);
	});
});

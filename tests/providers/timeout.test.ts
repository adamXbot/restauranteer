import { describe, expect, it } from 'vitest';
import { timeout, parseDirectoryTiles } from '../../src/lib/server/providers/scraper/timeout';

describe('timeout.matchesUrl', () => {
	it('accepts individual restaurant URLs', () => {
		expect(timeout.matchesUrl('https://www.timeout.com/melbourne/restaurants/kokoras')).toBe(true);
		expect(timeout.matchesUrl('https://www.timeout.com/sydney/restaurants/poly')).toBe(true);
		expect(timeout.matchesUrl('https://www.timeout.com/brisbane/restaurants/anyplace')).toBe(true);
		expect(timeout.matchesUrl('https://www.timeout.com/melbourne/bars/some-bar')).toBe(true);
	});

	it('rejects editorial list URLs', () => {
		expect(
			timeout.matchesUrl('https://www.timeout.com/melbourne/restaurants/the-best-cafes-in-melbourne')
		).toBe(false);
		expect(
			timeout.matchesUrl('https://www.timeout.com/melbourne/restaurants/best-lygon-street-restaurants')
		).toBe(false);
		expect(
			timeout.matchesUrl('https://www.timeout.com/melbourne/restaurants/cbd-lunch-guide-cheap-eats')
		).toBe(false);
		expect(
			timeout.matchesUrl('https://www.timeout.com/melbourne/restaurants/the-best-restaurants-in-footscray')
		).toBe(false);
	});

	it('rejects cities Time Out doesn\'t cover (or we don\'t support)', () => {
		expect(timeout.matchesUrl('https://www.timeout.com/london/restaurants/dishoom')).toBe(false);
		expect(timeout.matchesUrl('https://www.timeout.com/new-york/restaurants/something')).toBe(false);
	});

	it('rejects URLs from other publications', () => {
		expect(timeout.matchesUrl('https://www.broadsheet.com.au/melbourne/restaurants/cumulus-inc')).toBe(
			false
		);
		expect(timeout.matchesUrl('https://example.com/restaurants/x')).toBe(false);
	});

	it('rejects malformed paths', () => {
		expect(timeout.matchesUrl('https://www.timeout.com/melbourne')).toBe(false);
		expect(timeout.matchesUrl('https://www.timeout.com/melbourne/restaurants')).toBe(false);
		expect(timeout.matchesUrl('https://www.timeout.com/')).toBe(false);
	});
});

describe('parseDirectoryTiles', () => {
	// Time Out's directory tiles wrap each card in <article class="tile">.
	// Individual restaurants render a star-rating widget with an "out of 5 stars"
	// sr-only label; editorial roundups don't. We filter on that signal.
	const sample = `<html><body>
		<article class="tile">
			<a href="/melbourne/restaurants/the-best-cafes-in-melbourne" class="link">
				<h4>The best cafes in Melbourne</h4>
			</a>
			<div data-testid="summary_testID">If you think breakfast is the most important meal…</div>
		</article>
		<article class="tile">
			<a href="/melbourne/restaurants/kokoras" class="link">
				<h4>Kokoras</h4>
				<img src="https://media.timeout.com/images/106405653/image.jpg" />
			</a>
			<span class="sr-only">5 out of 5 stars</span>
			<div data-testid="summary_testID">Chef-led charcoal chicken with a Greek lean.</div>
		</article>
		<article class="tile">
			<a href="/melbourne/restaurants/daphne" class="link">
				<h4>Daphne</h4>
			</a>
			<span class="sr-only">4 out of 5 stars</span>
			<div data-testid="summary_testID">Daphne makes dining out feel easy.</div>
		</article>
		<article class="tile">
			<a href="/melbourne/restaurants/the-best-restaurants-in-footscray" class="link">
				<h4>Best in Footscray</h4>
			</a>
			<div data-testid="summary_testID">Footscray is rapidly becoming…</div>
		</article>
	</body></html>`;

	it('keeps tiles that have a star rating', () => {
		const result = parseDirectoryTiles(sample, 'melbourne');
		expect(result.map((r) => r.url.split('/').pop())).toEqual(['kokoras', 'daphne']);
	});

	it('strips editorial-list slugs even if a star somehow appears', () => {
		const html = `<article class="tile">
			<a href="/melbourne/restaurants/the-best-cafes-in-melbourne"><h4>Best cafes</h4></a>
			<span class="sr-only">3 out of 5 stars</span>
		</article>`;
		expect(parseDirectoryTiles(html, 'melbourne')).toEqual([]);
	});

	it('returns suburb=null because the directory cards don\'t expose it', () => {
		const result = parseDirectoryTiles(sample, 'melbourne');
		for (const r of result) expect(r.suburb).toBeNull();
	});

	it('deduplicates if the same restaurant appears twice', () => {
		const html = `<html>
			<article class="tile">
				<a href="/melbourne/restaurants/kokoras"><h4>Kokoras</h4></a>
				<span>5 out of 5 stars</span>
			</article>
			<article class="tile">
				<a href="/melbourne/restaurants/kokoras"><h4>Kokoras (dupe)</h4></a>
				<span>5 out of 5 stars</span>
			</article>
		</html>`;
		const result = parseDirectoryTiles(html, 'melbourne');
		expect(result).toHaveLength(1);
	});

	it('ignores tiles from a different city', () => {
		const html = `<html>
			<article class="tile">
				<a href="/sydney/restaurants/poly"><h4>Poly</h4></a>
				<span>5 out of 5 stars</span>
			</article>
		</html>`;
		expect(parseDirectoryTiles(html, 'melbourne')).toEqual([]);
	});
});

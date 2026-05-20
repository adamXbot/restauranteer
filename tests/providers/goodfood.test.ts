import { describe, expect, it } from 'vitest';
import { goodfood, isGuideReviewUrl } from '../../src/lib/server/providers/scraper/goodfood';

describe('goodfood.matchesUrl', () => {
	it('accepts any /goodfood/ URL so non-guide URLs get a precise rejection from extract', () => {
		expect(
			goodfood.matchesUrl(
				'https://www.theage.com.au/goodfood/vic-good-food-guide/laikon-deli-20260507-p5zuur.html'
			)
		).toBe(true);
		expect(
			goodfood.matchesUrl(
				'https://www.theage.com.au/goodfood/melbourne-eating-out/where-to-eat-ramen-20260101-aaaaaa.html'
			)
		).toBe(true);
	});

	it('rejects unrelated hosts', () => {
		expect(goodfood.matchesUrl('https://www.example.com/goodfood/anything')).toBe(false);
		expect(goodfood.matchesUrl('https://broadsheet.com.au/melbourne/restaurants/cumulus')).toBe(false);
	});
});

describe('isGuideReviewUrl', () => {
	it('accepts canonical Good Food Guide review URLs', () => {
		expect(
			isGuideReviewUrl(
				'https://www.theage.com.au/goodfood/vic-good-food-guide/laikon-deli-20260507-p5zuur.html'
			)
		).toBe(true);
		expect(
			isGuideReviewUrl(
				'https://www.smh.com.au/goodfood/nsw-good-food-guide/some-restaurant-20260101-abcdef.html'
			)
		).toBe(true);
	});

	it('rejects non-guide Good Food URLs (listicles, recipes, news)', () => {
		expect(
			isGuideReviewUrl(
				'https://www.theage.com.au/goodfood/melbourne-eating-out/where-to-eat-ramen-20260101-aaaaaa.html'
			)
		).toBe(false);
		expect(
			isGuideReviewUrl('https://www.theage.com.au/goodfood/recipes/pho-20260101-aaaaaa.html')
		).toBe(false);
		expect(
			isGuideReviewUrl(
				'https://www.theage.com.au/goodfood/topic/good-food-guide-victoria-6guk'
			)
		).toBe(false);
	});

	it('rejects malformed URLs', () => {
		expect(isGuideReviewUrl('not-a-url')).toBe(false);
		expect(isGuideReviewUrl('https://www.example.com/foo')).toBe(false);
	});
});

describe('goodfood.extract', () => {
	it('rejects non-guide URLs with a clear, specific error', async () => {
		await expect(
			goodfood.extract(
				'https://www.theage.com.au/goodfood/melbourne-eating-out/where-to-eat-ramen-20260101-aaaaaa.html'
			)
		).rejects.toThrow(/Good Food Guide/);
	});
});

describe('goodfood.cities', () => {
	it('only exposes cities that have a confirmed guide section', () => {
		const ids = goodfood.cities.map((c) => c.id).sort();
		expect(ids).toEqual(['melbourne', 'sydney']);
	});
});

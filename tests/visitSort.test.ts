import { describe, expect, it } from 'vitest';
import {
	activeRatingArea,
	isVisitSortMode,
	sortVisits,
	type VisitFeedItem
} from '../src/lib/visitSort';

function visit(partial: Partial<VisitFeedItem> & { restaurantName: string; date: string }): VisitFeedItem {
	return {
		restaurantUuid: partial.restaurantUuid ?? `${partial.restaurantName}-${partial.date}`,
		restaurantName: partial.restaurantName,
		suburb: partial.suburb ?? null,
		index: partial.index ?? 0,
		date: partial.date,
		meal: partial.meal ?? null,
		overallRating: partial.overallRating ?? null,
		vibeRating: partial.vibeRating ?? null,
		foodRating: partial.foodRating ?? null,
		qualityRating: partial.qualityRating ?? null,
		serviceRating: partial.serviceRating ?? null,
		notesExcerpt: partial.notesExcerpt ?? null,
		photo: partial.photo ?? null
	};
}

const SAMPLE: VisitFeedItem[] = [
	visit({ restaurantName: 'Cumulus', date: '2026-05-10', overallRating: 4, foodRating: 3 }),
	visit({ restaurantName: 'Attica', date: '2026-06-01', overallRating: 5, foodRating: 5 }),
	visit({ restaurantName: 'Baba', date: '2026-04-01', overallRating: 2, foodRating: null }),
	visit({ restaurantName: 'attica', date: '2026-03-01', overallRating: null, foodRating: 4 })
];

const names = (items: VisitFeedItem[]) => items.map((v) => `${v.restaurantName}@${v.date}`);

describe('sortVisits', () => {
	it('does not mutate the input array', () => {
		const before = [...SAMPLE];
		sortVisits(SAMPLE, 'recent');
		expect(SAMPLE).toEqual(before);
	});

	it('recent → newest date first', () => {
		expect(names(sortVisits(SAMPLE, 'recent'))).toEqual([
			'Attica@2026-06-01',
			'Cumulus@2026-05-10',
			'Baba@2026-04-01',
			'attica@2026-03-01'
		]);
	});

	it('oldest → oldest date first', () => {
		expect(names(sortVisits(SAMPLE, 'oldest'))[0]).toBe('attica@2026-03-01');
	});

	it('az → case-insensitive by restaurant name', () => {
		const sorted = sortVisits(SAMPLE, 'az').map((v) => v.restaurantName.toLowerCase());
		expect(sorted).toEqual(['attica', 'attica', 'baba', 'cumulus']);
	});

	it('za → reverse name order', () => {
		expect(sortVisits(SAMPLE, 'za')[0].restaurantName.toLowerCase()).toBe('cumulus');
	});

	it('overall_desc → highest overall first', () => {
		expect(names(sortVisits(SAMPLE, 'overall_desc'))).toEqual([
			'Attica@2026-06-01',
			'Cumulus@2026-05-10',
			'Baba@2026-04-01',
			'attica@2026-03-01' // null overall sinks to bottom
		]);
	});

	it('overall_asc → lowest first but nulls still last', () => {
		const sorted = names(sortVisits(SAMPLE, 'overall_asc'));
		expect(sorted[0]).toBe('Baba@2026-04-01'); // rating 2
		expect(sorted[sorted.length - 1]).toBe('attica@2026-03-01'); // null last
	});

	it('food_desc → ranks by food rating, null food last', () => {
		const sorted = names(sortVisits(SAMPLE, 'food_desc'));
		expect(sorted[0]).toBe('Attica@2026-06-01'); // food 5
		expect(sorted[sorted.length - 1]).toBe('Baba@2026-04-01'); // null food last
	});
});

describe('activeRatingArea', () => {
	it('maps rating modes to their area', () => {
		expect(activeRatingArea('overall_desc')).toBe('overall');
		expect(activeRatingArea('food_asc')).toBe('food');
		expect(activeRatingArea('vibe_desc')).toBe('vibe');
	});

	it('returns null for non-rating modes', () => {
		expect(activeRatingArea('recent')).toBeNull();
		expect(activeRatingArea('az')).toBeNull();
	});
});

describe('isVisitSortMode', () => {
	it('accepts known modes and rejects junk', () => {
		expect(isVisitSortMode('food_desc')).toBe(true);
		expect(isVisitSortMode('nonsense')).toBe(false);
		expect(isVisitSortMode(null)).toBe(false);
	});
});

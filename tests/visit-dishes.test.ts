import { describe, expect, it } from 'vitest';
import {
	averageDishRatings,
	coerceDishMeta,
	parseVisitFields,
	parseVisits,
	visitBlock,
	type VisitInput
} from '../src/lib/server/vault/visit';

function inSection(text: string) {
	return `## Visits\n\n${text}\n`;
}

function roundTrip(visit: VisitInput) {
	const visits = parseVisits(inSection(visitBlock(visit)));
	expect(visits).toHaveLength(1);
	return parseVisitFields(visits[0]);
}

describe('averageDishRatings', () => {
	it('averages only the rated dishes', () => {
		expect(
			averageDishRatings([
				{ name: 'a', rating: 5, note: null, photoPath: null },
				{ name: 'b', rating: 3, note: null, photoPath: null },
				{ name: 'c', rating: null, note: null, photoPath: null }
			])
		).toBe(4);
	});

	it('returns null when nothing is rated', () => {
		expect(averageDishRatings([{ name: 'a', rating: null, note: null, photoPath: null }])).toBeNull();
		expect(averageDishRatings([])).toBeNull();
		expect(averageDishRatings(null)).toBeNull();
	});

	it('rounds to one decimal', () => {
		expect(
			averageDishRatings([
				{ name: 'a', rating: 5, note: null, photoPath: null },
				{ name: 'b', rating: 4, note: null, photoPath: null },
				{ name: 'c', rating: 4, note: null, photoPath: null }
			])
		).toBe(4.3);
	});
});

describe('coerceDishMeta', () => {
	it('parses a JSON string and clamps ratings', () => {
		const meta = coerceDishMeta(
			JSON.stringify([
				{ name: 'Pizza', rating: 5, note: 'great', keepPhoto: '_attachments/x/d1.jpg' },
				{ name: 'Soup', rating: 9, note: '', keepPhoto: 'http://evil' }
			])
		);
		expect(meta).toEqual([
			{ name: 'Pizza', rating: 5, note: 'great', keepPhoto: '_attachments/x/d1.jpg' },
			{ name: 'Soup', rating: null, note: null, keepPhoto: null }
		]);
	});

	it('drops fully-empty entries and tolerates junk', () => {
		expect(coerceDishMeta('not json')).toEqual([]);
		expect(coerceDishMeta([{ name: '', rating: null, note: '' }, null, 5])).toEqual([]);
	});
});

describe('dish breakdown round-trip', () => {
	it('serializes dishes under Food and derives the food rating from their average', () => {
		const visit: VisitInput = {
			date: '2026-06-17',
			meal: 'Dinner',
			areaRatings: { vibe: 4, quality: 5, service: 4 },
			imagePaths: [],
			dishes: [
				{ name: 'Margherita', rating: 5, note: 'wood-fired', photoPath: '_attachments/x/d1.jpg' },
				{ name: 'Carbonara', rating: 3, note: null, photoPath: null }
			]
		};

		const block = visitBlock(visit);
		expect(block).toContain('**Food:** ★★★★☆');
		expect(block).toContain('- **Margherita** ★★★★★ — wood-fired');
		expect(block).toContain('  ![](_attachments/x/d1.jpg)');
		expect(block).toContain('- **Carbonara** ★★★☆☆');
		// overall avg = (vibe 4 + food 4 + quality 5 + service 4) / 4 = 4.25, rounded to 4.3
		expect(block).toContain('**Rating:** 4.3/5 (avg)');

		const fields = roundTrip(visit);
		expect(fields.dishes).toEqual([
			{ name: 'Margherita', rating: 5, note: 'wood-fired', photoPath: '_attachments/x/d1.jpg' },
			{ name: 'Carbonara', rating: 3, note: null, photoPath: null }
		]);
		expect(fields.foodRating).toBe(4);
		expect(fields.food).toBeNull();
	});

	it('keeps an overall food note alongside dishes and preserves trailing notes', () => {
		const visit: VisitInput = {
			date: '2026-06-17',
			areaRatings: {},
			imagePaths: [],
			food: 'Shared small plates',
			notes: 'Lovely evening.',
			dishes: [{ name: 'Oysters', rating: 4, note: 'briny', photoPath: null }]
		};
		const fields = roundTrip(visit);
		expect(fields.food).toBe('Shared small plates');
		expect(fields.foodRating).toBe(4);
		expect(fields.dishes).toHaveLength(1);
		expect(fields.notes).toBe('Lovely evening.');
	});

	it('handles dishes with no rating (bare Food line anchor)', () => {
		const visit: VisitInput = {
			date: '2026-06-17',
			areaRatings: {},
			imagePaths: [],
			dishes: [{ name: 'Bread', rating: null, note: 'free', photoPath: null }]
		};
		const block = visitBlock(visit);
		expect(block).toContain('**Food:**');
		expect(block).toContain('- **Bread** — free');

		const fields = roundTrip(visit);
		expect(fields.dishes).toEqual([{ name: 'Bread', rating: null, note: 'free', photoPath: null }]);
		expect(fields.foodRating).toBeNull();
	});

	it('does not swallow general visit photos into the last dish', () => {
		const visit: VisitInput = {
			date: '2026-06-17',
			areaRatings: { vibe: 4 },
			imagePaths: ['_attachments/x/general.jpg'],
			dishes: [{ name: 'Taco', rating: 5, note: null, photoPath: '_attachments/x/d1.jpg' }]
		};
		const fields = roundTrip(visit);
		expect(fields.dishes).toHaveLength(1);
		expect(fields.dishes[0].photoPath).toBe('_attachments/x/d1.jpg');
		// The general photo stays a visit photo, not a dish photo.
		expect(fields.photoPaths).toContain('_attachments/x/general.jpg');
	});

	it('leaves dish-free visits unchanged', () => {
		const visit: VisitInput = {
			date: '2026-06-17',
			areaRatings: { vibe: 4, food: 3, quality: 5, service: 4 },
			imagePaths: []
		};
		const block = visitBlock(visit);
		expect(block).not.toContain('- **');
		const fields = roundTrip(visit);
		expect(fields.dishes).toEqual([]);
		expect(fields.foodRating).toBe(3);
	});
});

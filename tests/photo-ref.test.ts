import { describe, expect, it } from 'vitest';
import { immichAssetId, isVisitPhoto, photoThumbUrl, photoUrl } from '../src/lib/photoRef';
import { coerceDishMeta, parseVisitFields, parseVisits, visitBlock } from '../src/lib/server/vault/visit';

const ID = '4d6f3c1e-8a2b-4c1d-9e0f-123456789abc';

describe('photo refs', () => {
	it('recognises immich refs by their uuid only', () => {
		expect(immichAssetId(`immich:${ID}`)).toBe(ID);
		expect(immichAssetId(`immich:${ID.toUpperCase()}`)).toBe(ID);
		expect(immichAssetId('immich:../../etc/passwd')).toBeNull();
		expect(immichAssetId(`immich:${ID}/x`)).toBeNull();
		expect(immichAssetId('_attachments/etta/a.jpg')).toBeNull();
	});

	it('accepts attachments and immich refs as visit photos', () => {
		expect(isVisitPhoto('_attachments/etta/a.jpg')).toBe(true);
		expect(isVisitPhoto(`immich:${ID}`)).toBe(true);
		expect(isVisitPhoto('https://example.com/a.jpg')).toBe(false);
		expect(isVisitPhoto('google:places/x/photos/y')).toBe(false);
	});

	it('builds proxy URLs for both kinds', () => {
		expect(photoUrl(`immich:${ID}`)).toBe(`/api/immich/${ID}?size=preview`);
		expect(photoThumbUrl(`immich:${ID}`)).toBe(`/api/immich/${ID}?size=thumbnail`);
		expect(photoUrl('_attachments/etta/a b.jpg')).toBe('/api/attachments/etta/a%20b.jpg');
		expect(photoThumbUrl('_attachments/etta/a.jpg')).toBe('/api/attachments/etta/a.thumb.jpg');
	});
});

describe('visits with immich photos', () => {
	it('round-trips immich refs through the Markdown', () => {
		const block = visitBlock({
			date: '2026-10-18',
			meal: 'Dinner',
			notes: 'From the receipt',
			imagePaths: ['_attachments/etta/a.jpg', `immich:${ID}`]
		});
		expect(block).toContain(`![](immich:${ID})`);
		const [visit] = parseVisits(`## Visits\n\n${block}\n`);
		expect(visit.photoPaths).toEqual(['_attachments/etta/a.jpg', `immich:${ID}`]);
		expect(parseVisitFields(visit).notes).toBe('From the receipt');
	});

	it('keeps an immich dish photo on edit', () => {
		const [dish] = coerceDishMeta([{ name: 'Dumplings', keepPhoto: `immich:${ID}` }]);
		expect(dish.keepPhoto).toBe(`immich:${ID}`);
	});
});

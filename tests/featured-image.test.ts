import { describe, it, expect } from 'vitest';
import { parseFeaturedImage, coverPhotoPath } from '../src/lib/featuredImage';
import type { VisitSummary } from '../src/lib/server/vault/visit';

const summary = (photo: string | null): VisitSummary => ({
	count: 1,
	latest: { date: '2026-05-09', meal: null, rating: 4, photo },
	earliest: { date: '2026-05-09', meal: null, rating: 4, photo },
	average: 4
});

describe('featured_image', () => {
	it('parses an attachment path', () => {
		expect(parseFeaturedImage('_attachments/etta/a.jpg')).toEqual({
			kind: 'attachment',
			path: '_attachments/etta/a.jpg'
		});
	});

	it('parses a Google photo reference', () => {
		expect(parseFeaturedImage('google:places/ChIJ1/photos/A')).toEqual({
			kind: 'google',
			photoName: 'places/ChIJ1/photos/A'
		});
	});

	// Absent means "derive one" — the behaviour before the key existed.
	it('treats absent, empty and malformed values as no choice', () => {
		for (const value of [undefined, null, '', '   ', 'google:', 42, {}]) {
			expect(parseFeaturedImage(value)).toBeNull();
		}
	});

	// This value becomes a URL path.
	it('rejects paths that escape the attachments tree', () => {
		for (const value of ['../../etc/passwd', '/etc/passwd', '_attachments/../x.jpg', 'x.jpg']) {
			expect(parseFeaturedImage(value)).toBeNull();
		}
	});

	describe('coverPhotoPath', () => {
		it('prefers the chosen attachment over the derived one', () => {
			expect(
				coverPhotoPath({ featured_image: '_attachments/etta/chosen.jpg' }, summary('_attachments/etta/derived.jpg'))
			).toBe('_attachments/etta/chosen.jpg');
		});

		it('falls back to the newest visit photo when unset', () => {
			expect(coverPhotoPath({}, summary('_attachments/etta/derived.jpg'))).toBe(
				'_attachments/etta/derived.jpg'
			);
		});

		// A card renders from the vault's own files; a list that needs a
		// Places request to draw a row is worse than one showing your photo.
		it('falls back for a Google pick, which has no local file', () => {
			expect(
				coverPhotoPath({ featured_image: 'google:places/X/photos/Y' }, summary('_attachments/etta/derived.jpg'))
			).toBe('_attachments/etta/derived.jpg');
		});

		it('is null when there is nothing at all', () => {
			expect(coverPhotoPath({}, summary(null))).toBeNull();
			expect(coverPhotoPath({}, null)).toBeNull();
		});
	});
});

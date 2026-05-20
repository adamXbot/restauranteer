import { describe, expect, it } from 'vitest';
import {
	appendVisitToBody,
	extractImagePaths,
	formatVisitForShare,
	parseVisitFields,
	parseVisits,
	removeVisitFromBody,
	slugFromFilePath,
	splitBodyAtVisits,
	updateVisitInBody,
	visitBlock
} from '../../src/lib/server/vault/visit';

describe('slugFromFilePath', () => {
	it('converts a name to kebab-case', () => {
		expect(slugFromFilePath('/vault/Restaurants/Cumulus Inc.md')).toBe('cumulus-inc');
	});

	it('drops punctuation', () => {
		expect(slugFromFilePath('/x/Vue de Monde (Fitzroy).md')).toBe('vue-de-monde-fitzroy');
	});
});

describe('visitBlock', () => {
	it('renders a full visit', () => {
		const block = visitBlock({
			date: '2026-05-15',
			meal: 'Lunch',
			vibe: 'Bright',
			food: 'Lamb',
			quality: 'Tender',
			service: 'Friendly',
			rating: 4,
			notes: 'Loved it.',
			imagePaths: ['_attachments/cumulus-inc/2026-05-15-1.jpg']
		});
		expect(block).toContain('### 2026-05-15 — Lunch');
		expect(block).toContain('**Vibe:** Bright');
		expect(block).toContain('**Rating:** 4/5');
		expect(block).toContain('Loved it.');
		expect(block).toContain('![](_attachments/cumulus-inc/2026-05-15-1.jpg)');
	});

	it('omits empty fields', () => {
		const block = visitBlock({ date: '2026-05-15', imagePaths: [] });
		expect(block).toContain('### 2026-05-15');
		expect(block).not.toContain('**Vibe:**');
		expect(block).not.toContain('**Rating:**');
	});

	it('renders companions on a With line', () => {
		const block = visitBlock({
			date: '2026-05-15',
			companions: 'Sarah, Tom',
			imagePaths: []
		});
		expect(block).toContain('**With:** Sarah, Tom');
	});

	it('renders per-area star ratings inline + average', () => {
		const block = visitBlock({
			date: '2026-05-15',
			vibe: 'Bright',
			food: 'Excellent lamb',
			areaRatings: { vibe: 4, food: 5, quality: 5, service: 4 },
			imagePaths: []
		});
		expect(block).toContain('**Vibe:** ★★★★☆ — Bright');
		expect(block).toContain('**Food:** ★★★★★ — Excellent lamb');
		expect(block).toContain('**Rating:** 4.5/5 (avg)');
		expect(block).not.toContain('**Rating:** 4/5'); // legacy single rating should not appear
	});

	it('uses single rating when no area ratings supplied', () => {
		const block = visitBlock({
			date: '2026-05-15',
			vibe: 'Bright',
			areaRatings: { vibe: null, food: null, quality: null, service: null },
			rating: 4,
			imagePaths: []
		});
		expect(block).toContain('**Vibe:** Bright');
		expect(block).not.toContain('★');
		expect(block).toContain('**Rating:** 4/5');
		expect(block).not.toContain('(avg)');
	});

	it('renders stars for areas that have ratings but no text', () => {
		const block = visitBlock({
			date: '2026-05-15',
			areaRatings: { vibe: 3, food: null, quality: null, service: null },
			imagePaths: []
		});
		expect(block).toContain('**Vibe:** ★★★☆☆');
		expect(block).toContain('**Rating:** 3/5 (avg)');
	});
});

describe('appendVisitToBody', () => {
	it('appends under existing ## Visits header', () => {
		const body = '## Overview\n\nA place.\n\n## Visits\n\n### 2026-05-01\n**Vibe:** old\n';
		const result = appendVisitToBody(body, {
			date: '2026-05-15',
			vibe: 'new',
			imagePaths: []
		});
		expect(result).toContain('### 2026-05-15');
		expect(result.indexOf('### 2026-05-01')).toBeLessThan(result.indexOf('### 2026-05-15'));
	});

	it('creates ## Visits if missing', () => {
		const body = '## Overview\n\nA place.\n';
		const result = appendVisitToBody(body, { date: '2026-05-15', imagePaths: [] });
		expect(result).toContain('## Visits');
		expect(result).toContain('### 2026-05-15');
	});
});

describe('extractImagePaths', () => {
	it('finds standard markdown images', () => {
		const body =
			'Some text\n![](_attachments/x/1.jpg)\nmore\n![alt](_attachments/y/2.png)\nignored: http://example.com/a.jpg';
		expect(extractImagePaths(body)).toEqual([
			'_attachments/x/1.jpg',
			'_attachments/y/2.png'
		]);
	});
});

const SAMPLE_BODY = `## Overview
A Flinders Lane classic.

## Visits

### 2026-05-15 — Lunch

**With:** Sarah, Tom
**Vibe:** Bright and busy
**Food:** Lamb shoulder
**Rating:** 4/5

Loved it. Would bring [[Friend]] next time.

![](_attachments/cumulus-inc/2026-05-15-001.jpg)

### 2026-05-18 — Dinner

**Vibe:** ★★★★☆ — Loud, fun
**Food:** ★★★★★ — Pasta
**Rating:** 4.5/5 (avg)

Even better the second time.
`;

describe('splitBodyAtVisits', () => {
	it('finds the Visits section', () => {
		const split = splitBodyAtVisits(SAMPLE_BODY);
		expect(split.before).toContain('## Overview');
		expect(split.visitsSection).toContain('### 2026-05-15');
		expect(split.visitsSection).toContain('### 2026-05-18');
		expect(split.after).toBe('');
	});

	it('returns empty visitsSection when no ## Visits heading', () => {
		const split = splitBodyAtVisits('## Overview\n\nJust prose.');
		expect(split.visitsSection).toBe('');
		expect(split.before).toContain('Overview');
	});

	it('separates a trailing section after Visits', () => {
		const body = '## Overview\nintro\n## Visits\n### 2026-05-15\nnotes\n## Outro\ntext';
		const split = splitBodyAtVisits(body);
		expect(split.before).toContain('Overview');
		expect(split.visitsSection).toContain('### 2026-05-15');
		expect(split.after).toContain('Outro');
	});
});

describe('parseVisits', () => {
	it('returns one entry per ### heading', () => {
		const split = splitBodyAtVisits(SAMPLE_BODY);
		const visits = parseVisits(split.visitsSection);
		expect(visits).toHaveLength(2);
		expect(visits[0].date).toBe('2026-05-15');
		expect(visits[0].meal).toBe('Lunch');
		expect(visits[0].photoPaths).toEqual(['_attachments/cumulus-inc/2026-05-15-001.jpg']);
		expect(visits[1].date).toBe('2026-05-18');
		expect(visits[1].meal).toBe('Dinner');
		expect(visits[1].photoPaths).toEqual([]);
	});

	it('returns empty array for empty section', () => {
		expect(parseVisits('')).toEqual([]);
	});
});

describe('formatVisitForShare', () => {
	const visits = parseVisits(splitBodyAtVisits(SAMPLE_BODY).visitsSection);

	it('full format strips markdown but keeps structured fields', () => {
		const text = formatVisitForShare(visits[0], 'Cumulus Inc', 'full');
		expect(text).toContain('Cumulus Inc — 2026-05-15 — Lunch');
		expect(text).toContain('With: Sarah, Tom');
		expect(text).toContain('Vibe: Bright and busy');
		expect(text).toContain('Rating: 4/5');
		expect(text).toContain('Loved it. Would bring [[Friend]] next time.');
		expect(text).not.toContain('**'); // no markdown bold
		expect(text).not.toContain('![](');
	});

	it('notes_only format drops the structured fields', () => {
		const text = formatVisitForShare(visits[0], 'Cumulus Inc', 'notes_only');
		expect(text).toContain('Cumulus Inc — 2026-05-15 — Lunch');
		expect(text).toContain('Loved it. Would bring');
		expect(text).not.toContain('With:');
		expect(text).not.toContain('Vibe:');
		expect(text).not.toContain('Food:');
		expect(text).not.toContain('Rating:');
	});

	it('keeps the date-only header when there are no notes (notes_only)', () => {
		const block = '### 2026-05-15\n**Vibe:** ok  \n**Rating:** 3/5  \n';
		const split = splitBodyAtVisits(`## Visits\n${block}`);
		const v = parseVisits(split.visitsSection);
		expect(formatVisitForShare(v[0], 'Spot', 'notes_only').trim()).toBe('Spot — 2026-05-15');
	});
});

describe('parseVisitFields', () => {
	it('extracts structured fields from a plain visit block', () => {
		const visits = parseVisits(splitBodyAtVisits(SAMPLE_BODY).visitsSection);
		const fields = parseVisitFields(visits[0]);
		expect(fields.companions).toBe('Sarah, Tom');
		expect(fields.vibe).toBe('Bright and busy');
		expect(fields.food).toBe('Lamb shoulder');
		expect(fields.rating).toBe(4);
		expect(fields.vibeRating).toBeNull();
		expect(fields.foodRating).toBeNull();
		expect(fields.notes).toContain('Loved it.');
		expect(fields.photoPaths).toEqual(['_attachments/cumulus-inc/2026-05-15-001.jpg']);
	});

	it('extracts per-area star ratings + text', () => {
		const visits = parseVisits(splitBodyAtVisits(SAMPLE_BODY).visitsSection);
		const fields = parseVisitFields(visits[1]);
		expect(fields.vibeRating).toBe(4);
		expect(fields.vibe).toBe('Loud, fun');
		expect(fields.foodRating).toBe(5);
		expect(fields.food).toBe('Pasta');
		expect(fields.rating).toBeNull(); // avg derived, not stored as plain rating
		expect(fields.notes).toContain('Even better the second time.');
	});

	it('handles a stars-only entry (no text after stars)', () => {
		const block = '### 2026-05-15\n**Vibe:** ★★★☆☆  \n**Rating:** 3/5 (avg)  \n';
		const split = splitBodyAtVisits(`## Visits\n${block}`);
		const v = parseVisits(split.visitsSection);
		const fields = parseVisitFields(v[0]);
		expect(fields.vibeRating).toBe(3);
		expect(fields.vibe).toBeNull();
	});
});

describe('updateVisitInBody', () => {
	it('replaces the i-th visit block', () => {
		const updated = updateVisitInBody(SAMPLE_BODY, 0, {
			date: '2026-05-15',
			meal: 'Lunch',
			vibe: 'New vibe',
			imagePaths: []
		});
		expect(updated).toContain('**Vibe:** New vibe');
		expect(updated).not.toContain('**Vibe:** Bright and busy');
		// second visit is preserved
		expect(updated).toContain('### 2026-05-18');
		expect(updated).toContain('Even better the second time.');
		// Overview is preserved
		expect(updated).toContain('## Overview');
	});

	it('keeps other visits intact', () => {
		const updated = updateVisitInBody(SAMPLE_BODY, 1, {
			date: '2026-05-18',
			meal: 'Dinner',
			notes: 'Replaced notes.',
			imagePaths: []
		});
		expect(updated).toContain('Replaced notes.');
		expect(updated).toContain('### 2026-05-15 — Lunch');
		expect(updated).toContain('Loved it.');
	});

	it('throws when index is out of range', () => {
		expect(() => updateVisitInBody(SAMPLE_BODY, 5, { date: '2026-01-01', imagePaths: [] })).toThrow();
	});
});

describe('removeVisitFromBody', () => {
	it('removes the i-th visit block', () => {
		const out = removeVisitFromBody(SAMPLE_BODY, 0);
		expect(out).not.toContain('### 2026-05-15');
		expect(out).not.toContain('Loved it.');
		expect(out).toContain('### 2026-05-18');
	});

	it('leaves the Visits header even when removing the only visit', () => {
		const body = '## Overview\nA spot.\n\n## Visits\n\n### 2026-05-15\n**Vibe:** ok  \nnotes\n';
		const out = removeVisitFromBody(body, 0);
		expect(out).toContain('## Visits');
		expect(out).not.toContain('### 2026-05-15');
	});

	it('throws when index is out of range', () => {
		expect(() => removeVisitFromBody(SAMPLE_BODY, 5)).toThrow();
	});
});

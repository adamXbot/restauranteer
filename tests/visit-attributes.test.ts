import { describe, expect, it } from 'vitest';
import {
	parseVisitFields,
	parseVisits,
	visitBlock,
	type VisitInput
} from '../src/lib/server/vault/visit';

function withAttributesBlock(text: string) {
	return `## Visits\n\n${text}\n`;
}

describe('visit.ts attribute overrides round-trip', () => {
	it('emits a **Attributes:** line when overrides are present', () => {
		const visit: VisitInput = {
			date: '2026-05-29',
			meal: 'Dinner',
			rating: 4,
			imagePaths: [],
			attributeOverrides: { pay_by_card: 'yes', walk_ins: 'no' }
		};
		const block = visitBlock(visit);
		expect(block).toContain('**Attributes:** pay_by_card=yes, walk_ins=no');
	});

	it('omits the line when there are no overrides', () => {
		const visit: VisitInput = {
			date: '2026-05-29',
			rating: 4,
			imagePaths: [],
			attributeOverrides: null
		};
		expect(visitBlock(visit)).not.toContain('**Attributes:**');
	});

	it('parses overrides back out and treats them as structural (not notes)', () => {
		const visit: VisitInput = {
			date: '2026-05-29',
			meal: 'Lunch',
			vibe: 'Sunny corner table',
			rating: 4.5,
			imagePaths: [],
			attributeOverrides: { pay_by_card: 'no' },
			notes: 'Cash only on this visit'
		};
		const body = withAttributesBlock(visitBlock(visit));
		const visits = parseVisits(body);
		expect(visits).toHaveLength(1);
		const fields = parseVisitFields(visits[0]);
		expect(fields.attributeOverrides).toEqual({ pay_by_card: 'no' });
		expect(fields.notes).toBe('Cash only on this visit');
		expect(fields.rating).toBe(4.5);
		expect(fields.vibe).toBe('Sunny corner table');
	});

	it('tolerates a hand-edited Attributes line with stray whitespace and bad entries', () => {
		const md = withAttributesBlock(
			`### 2026-05-29 — Dinner

**Rating:** 4/5
**Attributes:**  pay_by_card = yes ,  bogus,    walk_ins=clear,  loyalty_card=no

Notes line below.
`
		);
		const visits = parseVisits(md);
		const fields = parseVisitFields(visits[0]);
		expect(fields.attributeOverrides).toEqual({ pay_by_card: 'yes', loyalty_card: 'no' });
		expect(fields.notes).toBe('Notes line below.');
	});

	it('still parses visits without an Attributes line', () => {
		const md = withAttributesBlock(
			`### 2026-05-29

**Rating:** 4/5

Notes line.
`
		);
		const visits = parseVisits(md);
		const fields = parseVisitFields(visits[0]);
		expect(fields.attributeOverrides).toEqual({});
		expect(fields.rating).toBe(4);
		expect(fields.notes).toBe('Notes line.');
	});
});

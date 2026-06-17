import { describe, expect, it } from 'vitest';
import {
	attributeAppliesTo,
	cleanAnswers,
	coerceAttributeAnswers,
	coerceAttributeDefinition,
	coerceAttributeDefinitions,
	effectiveAttributeValue,
	parseOverrideLine,
	serializeOverrides,
	slugifyLabel,
	uniqueAttributeId,
	type AttributeDefinition
} from '../src/lib/attributes';

describe('slugifyLabel', () => {
	it('lower-snakes simple labels', () => {
		expect(slugifyLabel('Pay by card')).toBe('pay_by_card');
		expect(slugifyLabel('Walk-ins welcome')).toBe('walk_ins_welcome');
	});

	it('collapses runs of non-alphanumerics', () => {
		expect(slugifyLabel('  $$$ extra-fancy!!!  ')).toBe('extra_fancy');
	});

	it('falls back to a default for unusable input', () => {
		expect(slugifyLabel('!!!')).toBe('attribute');
		expect(slugifyLabel('')).toBe('attribute');
	});
});

describe('uniqueAttributeId', () => {
	it('returns the slug when free', () => {
		expect(uniqueAttributeId('Pay by card', [])).toBe('pay_by_card');
	});

	it('disambiguates with a numeric suffix on collision', () => {
		expect(uniqueAttributeId('Pay by card', ['pay_by_card'])).toBe('pay_by_card_2');
		expect(uniqueAttributeId('Pay by card', ['pay_by_card', 'pay_by_card_2'])).toBe('pay_by_card_3');
	});
});

describe('coerceAttributeDefinition', () => {
	it('strips garbage and normalises scope arrays', () => {
		const out = coerceAttributeDefinition({
			label: '  Walk-ins  ',
			description: 'Drop-ins welcome',
			scope: {
				tags: ['  casual ', 'CASUAL', 'fine-dining', 5],
				cuisines: ['Italian', 'italian'],
				lists: ['  ']
			}
		});
		expect(out?.id).toBe('walk_ins');
		expect(out?.label).toBe('Walk-ins');
		expect(out?.description).toBe('Drop-ins welcome');
		// dedup case-insensitively, drop bad types
		expect(out?.scope.tags).toEqual(['casual', 'fine-dining']);
		expect(out?.scope.cuisines).toEqual(['Italian']);
		// empty list is omitted entirely
		expect(out?.scope.lists).toBeUndefined();
	});

	it('rejects entries without a usable label', () => {
		expect(coerceAttributeDefinition(null)).toBeNull();
		expect(coerceAttributeDefinition({})).toBeNull();
		expect(coerceAttributeDefinition({ label: '   ' })).toBeNull();
	});
});

describe('coerceAttributeDefinitions', () => {
	it('drops invalids and de-collides ids', () => {
		const out = coerceAttributeDefinitions([
			{ label: 'Pay by card' },
			{ label: 'Pay by card' }, // duplicate id
			{ label: '   ' }, // dropped
			'not an object'
		]);
		expect(out.map((d) => d.id)).toEqual(['pay_by_card', 'pay_by_card_2']);
	});

	it('returns [] for non-arrays', () => {
		expect(coerceAttributeDefinitions(null)).toEqual([]);
		expect(coerceAttributeDefinitions({})).toEqual([]);
	});
});

describe('coerceAttributeAnswers', () => {
	it('keeps yes/no, drops everything else', () => {
		const out = coerceAttributeAnswers({
			pay_by_card: 'yes',
			walk_ins: 'no',
			junk: 'maybe',
			'Whitespace ID': 'yes',
			bool_true: true,
			bool_false: false,
			nope: null
		});
		expect(out).toEqual({
			pay_by_card: 'yes',
			walk_ins: 'no',
			whitespace_id: 'yes',
			bool_true: 'yes',
			bool_false: 'no'
		});
	});
});

describe('attributeAppliesTo', () => {
	const base: AttributeDefinition = {
		id: 'x',
		label: 'X',
		scope: {}
	};

	it('matches every restaurant with empty scope', () => {
		expect(
			attributeAppliesTo(base, { tags: [], cuisines: [], lists: [] })
		).toBe(true);
		expect(
			attributeAppliesTo(base, { tags: ['t'], cuisines: ['Italian'], lists: ['L'] })
		).toBe(true);
	});

	it('ORs within a dimension', () => {
		const def = { ...base, scope: { cuisines: ['Italian', 'Pizza'] } };
		expect(attributeAppliesTo(def, { tags: [], cuisines: ['italian'], lists: [] })).toBe(true);
		expect(attributeAppliesTo(def, { tags: [], cuisines: ['Thai'], lists: [] })).toBe(false);
	});

	it('ANDs across dimensions', () => {
		const def = { ...base, scope: { cuisines: ['Italian'], tags: ['casual'] } };
		expect(
			attributeAppliesTo(def, { tags: ['casual'], cuisines: ['Italian'], lists: [] })
		).toBe(true);
		// cuisine matches but tag does not
		expect(
			attributeAppliesTo(def, { tags: ['fancy'], cuisines: ['Italian'], lists: [] })
		).toBe(false);
	});

	it('case-insensitive matching', () => {
		const def = { ...base, scope: { tags: ['Fine-Dining'] } };
		expect(attributeAppliesTo(def, { tags: ['fine-dining'], cuisines: [], lists: [] })).toBe(true);
	});
});

describe('serializeOverrides / parseOverrideLine', () => {
	it('round-trips yes and no overrides', () => {
		const overrides = { pay_by_card: 'yes' as const, walk_ins: 'no' as const };
		const line = serializeOverrides(overrides);
		expect(line).toBe('pay_by_card=yes, walk_ins=no');
		expect(parseOverrideLine(line!)).toEqual(overrides);
	});

	it('returns null for empty / undefined input', () => {
		expect(serializeOverrides(null)).toBeNull();
		expect(serializeOverrides(undefined)).toBeNull();
		expect(serializeOverrides({})).toBeNull();
	});

	it('skips invalid values when serialising', () => {
		// @ts-expect-error testing runtime filtering of garbage
		expect(serializeOverrides({ a: 'maybe' })).toBeNull();
	});

	it('parses tolerantly (true/false/0/1)', () => {
		expect(parseOverrideLine('a=true, b=false, c=1, d=0, e=clear, junkline')).toEqual({
			a: 'yes',
			b: 'no',
			c: 'yes',
			d: 'no'
		});
	});
});

describe('effectiveAttributeValue', () => {
	it('override wins over restaurant default', () => {
		expect(effectiveAttributeValue('a', { a: 'yes' }, { a: 'no' })).toBe('no');
	});

	it('restaurant default applies when override missing', () => {
		expect(effectiveAttributeValue('a', { a: 'yes' }, {})).toBe('yes');
		expect(effectiveAttributeValue('a', { a: 'yes' }, null)).toBe('yes');
	});

	it('returns null when neither set', () => {
		expect(effectiveAttributeValue('a', {}, {})).toBeNull();
		expect(effectiveAttributeValue('a', undefined, undefined)).toBeNull();
	});
});

describe('cleanAnswers', () => {
	it('keeps only yes/no with slugified keys', () => {
		const out = cleanAnswers({
			pay_by_card: 'yes',
			Walk_Ins: 'no',
			// @ts-expect-error runtime garbage
			garbage: 'maybe'
		});
		expect(out).toEqual({ pay_by_card: 'yes', walk_ins: 'no' });
	});
});

import { describe, expect, it } from 'vitest';
import { noteSegments } from '../src/lib/noteSegments';

describe('noteSegments', () => {
	it('keeps link text and drops the URL', () => {
		expect(
			noteSegments('Total $45.20 · [Receipt](https://paperless.example/documents/1994/details)')
		).toEqual([
			{ text: 'Total $45.20 · ' },
			{ text: 'Receipt', href: 'https://paperless.example/documents/1994/details' }
		]);
	});

	it('links bare URLs', () => {
		expect(noteSegments('see https://a.example/x')).toEqual([
			{ text: 'see ' },
			{ text: 'https://a.example/x', href: 'https://a.example/x' }
		]);
	});

	it('keeps bold, italic and code', () => {
		expect(noteSegments('**kalbi** and _tip_ `x`')).toEqual([
			{ text: 'kalbi', strong: true },
			{ text: ' and ' },
			{ text: 'tip', em: true },
			{ text: ' ' },
			{ text: 'x', code: true }
		]);
	});

	it('italicises wikilinks', () => {
		expect(noteSegments('with [[Friend]]')).toEqual([
			{ text: 'with ' },
			{ text: 'Friend', em: true }
		]);
	});

	it('runs paragraphs and list items together', () => {
		expect(noteSegments('Great.\n\nTotal $10\n\n- one\n- two')).toEqual([
			{ text: 'Great. Total $10 one two' }
		]);
	});

	it('leaves unsafe links and raw HTML as text', () => {
		expect(noteSegments('[x](javascript:alert(1)) <b>y</b>')).toEqual([{ text: 'x <b>y</b>' }]);
	});

	it('is null for empty notes', () => {
		expect(noteSegments(null)).toBeNull();
		expect(noteSegments('')).toBeNull();
		expect(noteSegments('\n\n')).toBeNull();
	});
});

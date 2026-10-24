import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { italicWikilinks, wikilinkText } from '../src/lib/wikilink';

describe('wikilinkText', () => {
	it.each([
		['Friend', 'Friend'],
		['Joe|Joseph', 'Joseph'],
		['Note#Heading', 'Note > Heading'],
		['Note#H1#H2', 'Note > H1 > H2'],
		['#Heading', 'Heading'],
		['Note#Heading|see here', 'see here']
	])('[[%s]] → %s', (inner, text) => {
		expect(wikilinkText(inner)).toBe(text);
	});
});

describe('italicWikilinks', () => {
	it('italicises the display text', () => {
		expect(italicWikilinks('with [[Joe|Joseph]] and [[Note#Heading]]')).toBe(
			'with *Joseph* and *Note > Heading*'
		);
	});

	it("keeps the link's own * and _ inside the emphasis", () => {
		expect(marked.parseInline(italicWikilinks('[[a*b_c]]'))).toBe('<em>a*b_c</em>');
	});
});

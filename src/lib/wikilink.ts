/**
 * Obsidian `[[wikilinks]]` for Markdown we render ourselves: there is no note
 * to link to, so each becomes its display text in italics.
 */

/** What Obsidian shows for a wikilink: the alias, else the note, headings as "Note > Heading". */
export function wikilinkText(inner: string): string {
	const bar = inner.indexOf('|');
	if (bar >= 0) return inner.slice(bar + 1).trim();
	return inner
		.split('#')
		.map((part) => part.trim())
		.filter(Boolean)
		.join(' > ');
}

/** Each `[[wikilink]]` as italic display text, escaped so its own `*` or `_` can't break out. */
export function italicWikilinks(markdown: string): string {
	return markdown.replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => {
		const text = wikilinkText(inner).replace(/[\\`*_[\]<]/g, '\\$&');
		return text ? `*${text}*` : '';
	});
}

/**
 * The body as it should be *searched and quoted*, not as it is stored.
 *
 * The FTS body column feeds `snippet()`, and a snippet of raw Markdown reads
 * as noise — `**Food:** The <mackerel> dumplings` — while attachment lines
 * contribute junk tokens (`_attachments`, timestamps, `thumb`, `jpg`) that
 * turn unrelated searches into false hits. This strips the vault body's own
 * conventions (visit.ts's bold labels, dish bullets, photo lines, headings)
 * down to the sentences the user actually wrote.
 *
 * Mirrors `SearchableText.plain` in the iOS repo (VaultIndex) so the two
 * peers index the same vault the same way.
 *
 * Lives in shared `$lib`, not `$lib/server`: the highlight helpers below
 * are consumed by the search UI, and nothing here touches Node.
 */
export function searchableText(body: string): string {
	const lines: string[] = [];
	for (const rawLine of body.split('\n')) {
		const trimmed = rawLine.trim();

		// Photo lines are pure junk tokens — drop them whole.
		if (trimmed.startsWith('![')) continue;

		let line = rawLine
			// Headings keep their text ("## Visits" → "Visits")…
			.replace(/^\s*#+\s+/, '')
			// …dish bullets keep name + note ("- **X** — note" → "X — note").
			.replace(/^\s*[-*]\s+/, '');

		// Emphasis markers vanish; the label text stays ("**Food:**" → "Food:").
		line = line.split('**').join('').split('`').join('');
		// Inline links keep their text: [title](url) → title. The URL would
		// otherwise tokenize into hostname fragments.
		line = line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

		lines.push(line);
	}
	return lines.join('\n');
}

/**
 * Highlight markers for `snippet()` output — private-use scalars, chosen
 * because they cannot appear in vault text, so splitting on them can never
 * misfire on a restaurant genuinely named with brackets. Same pair the iOS
 * app uses.
 */
export const HIGHLIGHT_BEGIN = '';
export const HIGHLIGHT_END = '';

export type SearchRun = { text: string; highlighted: boolean };

/** Marked text → runs, in order, for the UI to style. */
export function searchRuns(marked: string): SearchRun[] {
	const runs: SearchRun[] = [];
	let current = '';
	let highlighted = false;
	for (const character of marked) {
		if (character === HIGHLIGHT_BEGIN || character === HIGHLIGHT_END) {
			if (current) runs.push({ text: current, highlighted });
			current = '';
			highlighted = character === HIGHLIGHT_BEGIN;
			continue;
		}
		current += character;
	}
	if (current) runs.push({ text: current, highlighted });
	return runs;
}

/**
 * Collapse the whitespace inside a snippet so a match found in a table or a
 * bullet renders as one line, keeping the boundary spaces that separate it
 * from neighbouring runs.
 */
export function collapseRun(text: string): string {
	const collapsed = text.split(/\s+/).filter(Boolean).join(' ');
	if (!collapsed) return text.length > 0 ? ' ' : '';
	const leading = /^\s/.test(text) ? ' ' : '';
	const trailing = text.length > 1 && /\s$/.test(text) ? ' ' : '';
	return `${leading}${collapsed}${trailing}`;
}

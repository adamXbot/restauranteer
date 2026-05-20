const NOTES_HEADING = '## Notes';
const NOTES_HEADING_RE = /^## Notes\s*$/m;
const NEXT_H2_RE = /^## \S/m;

type SectionRange = {
	headingStart: number;
	contentStart: number;
	end: number;
};

function notesRange(body: string): SectionRange | null {
	const match = body.match(NOTES_HEADING_RE);
	if (!match || match.index === undefined) return null;
	const headingStart = match.index;
	const contentStart = headingStart + match[0].length;
	const tail = body.slice(contentStart);
	const next = tail.search(NEXT_H2_RE);
	return {
		headingStart,
		contentStart,
		end: next < 0 ? body.length : contentStart + next
	};
}

function joinMarkdownParts(parts: string[]): string {
	const joined = parts
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join('\n\n');
	return joined ? `${joined}\n` : '';
}

export function extractRestaurantNotes(body: string): string {
	const range = notesRange(body);
	if (!range) return '';
	return body.slice(range.contentStart, range.end).trim();
}

export function removeRestaurantNotesSection(body: string): string {
	const range = notesRange(body);
	if (!range) return body;
	return joinMarkdownParts([body.slice(0, range.headingStart), body.slice(range.end)]);
}

export function updateRestaurantNotes(body: string, notes: string): string {
	const cleaned = notes.trim();
	const range = notesRange(body);
	const section = cleaned ? `${NOTES_HEADING}\n\n${cleaned}` : '';
	if (range) {
		return joinMarkdownParts([body.slice(0, range.headingStart), section, body.slice(range.end)]);
	}
	if (!section) return body;

	const visitsMatch = body.match(/^## Visits\s*$/m);
	if (!visitsMatch || visitsMatch.index === undefined) {
		return joinMarkdownParts([body, section]);
	}
	return joinMarkdownParts([
		body.slice(0, visitsMatch.index),
		section,
		body.slice(visitsMatch.index)
	]);
}

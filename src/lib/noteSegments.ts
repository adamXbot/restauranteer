import { marked, type Token, type Tokens } from 'marked';

/** A run of visit-note text, styled as its Markdown had it. */
export type NoteSegment = {
	text: string;
	href?: string;
	strong?: boolean;
	em?: boolean;
	code?: boolean;
};

type Style = Omit<NoteSegment, 'text'>;

const SAFE_HREF = /^(https?:|mailto:)/i;

/**
 * A visit note's Markdown as styled runs for the Visits feed preview: links,
 * bold, italic and code survive, blocks run together, raw HTML stays text.
 * `[[wikilinks]]` turn italic, as on the restaurant page.
 * The page renders the runs as Svelte text, so no note reaches it as HTML.
 */
export function noteSegments(markdown: string | null): NoteSegment[] | null {
	if (!markdown) return null;
	const out: NoteSegment[] = [];
	walk(marked.lexer(markdown.replace(/\[\[([^\]]+)\]\]/g, '*$1*')), {}, out, true);
	if (out.length > 0) {
		out[0].text = out[0].text.trimStart();
		out[out.length - 1].text = out[out.length - 1].text.trimEnd();
	}
	const segments = out.filter((s) => s.text.length > 0);
	return segments.length > 0 ? segments : null;
}

function walk(tokens: Token[], style: Style, out: NoteSegment[], block: boolean): void {
	for (const t of tokens) {
		switch (t.type) {
			case 'space':
				break;
			case 'link': {
				const { href, tokens: inner } = t as Tokens.Link;
				walk(inner, SAFE_HREF.test(href) ? { ...style, href } : style, out, false);
				break;
			}
			case 'strong':
				walk((t as Tokens.Strong).tokens, { ...style, strong: true }, out, false);
				break;
			case 'em':
				walk((t as Tokens.Em).tokens, { ...style, em: true }, out, false);
				break;
			case 'codespan':
				push(out, (t as Tokens.Codespan).text, { ...style, code: true });
				break;
			case 'br':
				push(out, ' ', style);
				break;
			case 'list':
				for (const item of (t as Tokens.List).items) walk(item.tokens, style, out, true);
				break;
			default:
				if ('tokens' in t && t.tokens) walk(t.tokens, style, out, false);
				else if ('text' in t && typeof t.text === 'string') push(out, t.text, style);
		}
		if (block && !/\s$/.test(out[out.length - 1]?.text ?? ' ')) push(out, ' ', {});
	}
}

function push(out: NoteSegment[], text: string, style: Style): void {
	const last = out[out.length - 1];
	if (
		last &&
		last.href === style.href &&
		last.strong === style.strong &&
		last.em === style.em &&
		last.code === style.code
	) {
		last.text += text;
	} else {
		out.push({ text, ...style });
	}
}

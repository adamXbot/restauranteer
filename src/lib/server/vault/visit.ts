import path from 'node:path';
import {
	parseOverrideLine,
	serializeOverrides,
	type AttributeValue
} from '$lib/attributes';

export type AreaRatings = {
	vibe?: number | null;
	food?: number | null;
	quality?: number | null;
	service?: number | null;
};

/**
 * A single dish within the Food area's breakdown. When a visit has dishes the
 * Food rating is derived from their average (see {@link averageDishRatings}).
 * `photoPath` is the final saved `_attachments/...` path, or null.
 */
export type Dish = {
	name: string;
	rating: number | null;
	note: string | null;
	photoPath: string | null;
};

export type VisitInput = {
	date: string;
	meal?: string | null;
	companions?: string | null;
	vibe?: string | null;
	food?: string | null;
	quality?: string | null;
	service?: string | null;
	rating?: number | null;
	areaRatings?: AreaRatings | null;
	notes?: string | null;
	imagePaths: string[];
	attributeOverrides?: Record<string, AttributeValue> | null;
	dishes?: Dish[] | null;
};

const MAX_DISHES = 20;
const MAX_DISH_NAME_LEN = 80;
const MAX_DISH_NOTE_LEN = 280;

/** Validated dish metadata coming off a form (photo handled separately). */
export type DishMeta = {
	name: string;
	rating: number | null;
	note: string | null;
	keepPhoto: string | null;
};

/** Average of the dishes that carry a positive rating, or null when none do. */
export function averageDishRatings(dishes: Dish[] | null | undefined): number | null {
	if (!dishes) return null;
	const values = dishes
		.map((d) => d.rating)
		.filter((v): v is number => typeof v === 'number' && v > 0);
	if (values.length === 0) return null;
	return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/**
 * Coerce the `dishes` form field (a JSON string or already-parsed array) into
 * validated metadata. Fully-empty entries are dropped; the list is capped.
 */
export function coerceDishMeta(raw: unknown): DishMeta[] {
	let arr: unknown = raw;
	if (typeof raw === 'string') {
		try {
			arr = JSON.parse(raw);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(arr)) return [];
	const out: DishMeta[] = [];
	for (const entry of arr) {
		if (!entry || typeof entry !== 'object') continue;
		const e = entry as Record<string, unknown>;
		const name = typeof e.name === 'string' ? e.name.trim().slice(0, MAX_DISH_NAME_LEN) : '';
		const noteRaw = typeof e.note === 'string' ? e.note.trim().slice(0, MAX_DISH_NOTE_LEN) : '';
		const note = noteRaw.length > 0 ? noteRaw : null;
		const rNum = typeof e.rating === 'number' ? e.rating : Number(e.rating);
		const rating = Number.isFinite(rNum) && rNum > 0 && rNum <= 5 ? Math.round(rNum) : null;
		const keepPhoto =
			typeof e.keepPhoto === 'string' && e.keepPhoto.startsWith('_attachments/')
				? e.keepPhoto
				: null;
		if (!name && rating === null && !note && !keepPhoto) continue;
		out.push({ name, rating, note, keepPhoto });
		if (out.length >= MAX_DISHES) break;
	}
	return out;
}

function dishLine(dish: Dish): string {
	const name = dish.name.trim() || 'Dish';
	const parts = [`- **${name}**`];
	if (typeof dish.rating === 'number' && dish.rating > 0) parts.push(stars(dish.rating));
	const note = dish.note?.trim();
	if (note) parts.push(`— ${note}`);
	return parts.join(' ');
}

function stars(rating: number | null | undefined, max = 5): string {
	if (rating == null || rating <= 0) return '';
	const full = Math.max(0, Math.min(max, Math.round(rating)));
	return '★'.repeat(full) + '☆'.repeat(max - full);
}

function averageAreaRatings(ar: AreaRatings | null | undefined): number | null {
	if (!ar) return null;
	const values = [ar.vibe, ar.food, ar.quality, ar.service].filter(
		(v): v is number => typeof v === 'number' && v > 0
	);
	if (values.length === 0) return null;
	const sum = values.reduce((a, b) => a + b, 0);
	return Math.round((sum / values.length) * 10) / 10;
}

export function slugFromFilePath(filePath: string): string {
	const base = path.basename(filePath, '.md');
	return base
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export function visitBlock(visit: VisitInput): string {
	const lines: string[] = [];
	const date = visit.date.trim();
	const meal = visit.meal?.trim();
	const header = meal ? `### ${date} — ${meal}` : `### ${date}`;
	lines.push(header, '');

	const companions = visit.companions?.trim();
	if (companions) lines.push(`**With:** ${companions}  `);

	// Dishes drive the Food rating: when present, the food area rating is their
	// average rather than any manually-supplied food_rating.
	const dishes = (visit.dishes ?? []).filter(
		(d) => d.name?.trim() || d.rating != null || d.note?.trim() || d.photoPath
	);
	const foodAvg = dishes.length > 0 ? averageDishRatings(dishes) : null;

	const baseAreaRatings = visit.areaRatings;
	const areaRatings: AreaRatings | null | undefined =
		foodAvg != null ? { ...baseAreaRatings, food: foodAvg } : baseAreaRatings;
	const usingAreaRatings = !!areaRatings && Object.values(areaRatings).some((v) => typeof v === 'number' && v > 0);

	const fields: Array<[string, string | null | undefined, keyof AreaRatings]> = [
		['Vibe', visit.vibe, 'vibe'],
		['Food', visit.food, 'food'],
		['Quality', visit.quality, 'quality'],
		['Service', visit.service, 'service']
	];
	for (const [label, value, areaKey] of fields) {
		const v = value?.trim();
		const r = areaRatings?.[areaKey];
		let emitted = false;
		if (usingAreaRatings && typeof r === 'number' && r > 0) {
			const prefix = `**${label}:** ${stars(r)}`;
			lines.push(v ? `${prefix} — ${v}  ` : `${prefix}  `);
			emitted = true;
		} else if (v) {
			lines.push(`**${label}:** ${v}  `);
			emitted = true;
		}
		if (areaKey === 'food' && dishes.length > 0) {
			// Ensure a Food header precedes the bullets so the parser can anchor them.
			if (!emitted) lines.push('**Food:**  ');
			for (const dish of dishes) {
				if (dish.photoPath) {
					lines.push(`${dishLine(dish)}  `);
					lines.push(`  ![](${dish.photoPath})`);
				} else {
					lines.push(dishLine(dish));
				}
			}
		}
	}

	if (usingAreaRatings) {
		const avg = averageAreaRatings(areaRatings);
		if (avg != null) lines.push(`**Rating:** ${avg}/5 (avg)  `);
	} else if (typeof visit.rating === 'number' && visit.rating > 0) {
		lines.push(`**Rating:** ${visit.rating}/5  `);
	}

	const attrLine = serializeOverrides(visit.attributeOverrides);
	if (attrLine) lines.push(`**Attributes:** ${attrLine}  `);

	const notes = visit.notes?.trim();
	if (notes) {
		lines.push('');
		lines.push(notes);
	}

	if (visit.imagePaths.length > 0) {
		lines.push('');
		for (const p of visit.imagePaths) {
			lines.push(`![](${p})`);
		}
	}

	lines.push('');
	return lines.join('\n');
}

export function appendVisitToBody(body: string, visit: VisitInput): string {
	const block = visitBlock(visit);
	const header = '## Visits';
	const idx = body.indexOf(header);
	const trimmed = body.replace(/\s+$/, '');
	if (idx < 0) {
		return `${trimmed}\n\n${header}\n\n${block}`;
	}
	return `${trimmed}\n\n${block}`;
}

const IMAGE_PATTERN = /!\[[^\]]*\]\(([^)]+)\)/g;

export function extractImagePaths(body: string): string[] {
	const out: string[] = [];
	for (const match of body.matchAll(IMAGE_PATTERN)) {
		out.push(match[1]);
	}
	return out;
}

export type BodySplit = { before: string; visitsSection: string; after: string };

/**
 * Split the markdown body into the part before "## Visits", the Visits section
 * itself (including the heading), and anything after it (rare).
 */
export function splitBodyAtVisits(body: string): BodySplit {
	const headerMatch = body.match(/^## Visits\s*$/m);
	if (!headerMatch || headerMatch.index === undefined) {
		return { before: body, visitsSection: '', after: '' };
	}
	const start = headerMatch.index;
	const tail = body.slice(start + headerMatch[0].length);
	const nextHeading = tail.search(/^## \S/m);
	if (nextHeading < 0) {
		return { before: body.slice(0, start), visitsSection: body.slice(start), after: '' };
	}
	return {
		before: body.slice(0, start),
		visitsSection: body.slice(start, start + headerMatch[0].length + nextHeading),
		after: body.slice(start + headerMatch[0].length + nextHeading)
	};
}

export type ParsedVisit = {
	id: string;
	index: number;
	date: string;
	meal: string | null;
	headline: string;
	rawMarkdown: string;
	photoPaths: string[];
};

export function parseVisits(visitsSection: string): ParsedVisit[] {
	if (!visitsSection.trim()) return [];
	const body = visitsSection.replace(/^## Visits\s*\n?/, '');
	const headers = [...body.matchAll(/^### (.+)$/gm)];
	const out: ParsedVisit[] = [];
	for (let i = 0; i < headers.length; i++) {
		const start = headers[i].index!;
		const end = i + 1 < headers.length ? headers[i + 1].index! : body.length;
		const block = body.slice(start, end).trimEnd();
		const headline = headers[i][1].trim();
		const dateMatch = headline.match(/^(\d{4}-\d{2}-\d{2})(?:\s*[—-]\s*(.+))?$/);
		const date = dateMatch ? dateMatch[1] : headline;
		const meal = dateMatch?.[2] ?? null;
		const photoPaths = [...block.matchAll(IMAGE_PATTERN)]
			.map((m) => m[1])
			.filter((p) => p.startsWith('_attachments/'));
		out.push({
			id: `visit-${i}`,
			index: i,
			date,
			meal,
			headline,
			rawMarkdown: block,
			photoPaths
		});
	}
	return out;
}

export type ParsedVisitFields = {
	date: string;
	meal: string | null;
	companions: string | null;
	vibe: string | null;
	food: string | null;
	quality: string | null;
	service: string | null;
	vibeRating: number | null;
	foodRating: number | null;
	qualityRating: number | null;
	serviceRating: number | null;
	rating: number | null;
	notes: string | null;
	photoPaths: string[];
	attributeOverrides: Record<string, AttributeValue>;
	dishes: Dish[];
};

const STRUCT_LINE_RE = /^\*\*(With|Vibe|Food|Quality|Service|Rating|Attributes):\*\*\s*(.+?)\s*$/i;
const DISH_LINE_RE = /^[-*]\s+\*\*(.+?)\*\*\s*([★☆]*)\s*(?:[—-]\s*(.*))?$/;
const DISH_IMG_RE = /^!\[[^\]]*\]\(([^)]+)\)$/;

function countStars(s: string): number {
	let n = 0;
	for (const ch of s) if (ch === '★') n++;
	return n;
}

/**
 * Consume dish bullets (and each dish's indented photo) starting at `start`.
 * Returns the dishes and the index of the first line that is not part of the
 * dish list.
 */
function consumeDishes(lines: string[], start: number): { dishes: Dish[]; next: number } {
	const dishes: Dish[] = [];
	let j = start;
	while (j < lines.length) {
		const dl = lines[j].replace(/ {2,}$/, '').trim();
		if (dl === '') break;
		const dm = dl.match(DISH_LINE_RE);
		if (dm) {
			const dStars = countStars(dm[2] ?? '');
			const dNote = (dm[3] ?? '').trim();
			dishes.push({
				name: dm[1].trim(),
				rating: dStars > 0 ? dStars : null,
				note: dNote.length > 0 ? dNote : null,
				photoPath: null
			});
			j++;
			continue;
		}
		const im = dl.match(DISH_IMG_RE);
		if (im && dishes.length > 0 && dishes[dishes.length - 1].photoPath === null) {
			dishes[dishes.length - 1].photoPath = im[1];
			j++;
			continue;
		}
		break;
	}
	return { dishes, next: j };
}

export function parseVisitFields(visit: ParsedVisit): ParsedVisitFields {
	const out: ParsedVisitFields = {
		date: visit.date,
		meal: visit.meal,
		companions: null,
		vibe: null,
		food: null,
		quality: null,
		service: null,
		vibeRating: null,
		foodRating: null,
		qualityRating: null,
		serviceRating: null,
		rating: null,
		notes: null,
		photoPaths: visit.photoPaths.slice(),
		attributeOverrides: {},
		dishes: []
	};

	const lines = visit.rawMarkdown
		.replace(/^### .*\n?/, '')
		.split('\n');

	let usedAreaRatings = false;
	let parsedRating: number | null = null;
	let isAvgRating = false;
	let notesStart = 0;
	let seenStructural = false;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i].replace(/ {2,}$/, '');
		const line = raw.trim();
		if (line === '') {
			if (!seenStructural) notesStart = i + 1;
			continue;
		}
		const m = line.match(STRUCT_LINE_RE);
		if (!m) {
			// A bare "**Food:**" line (no rating, no note) still anchors a dish
			// breakdown when the user added dishes without rating any of them.
			if (/^\*\*Food:\*\*$/i.test(line)) {
				seenStructural = true;
				notesStart = i + 1;
				const consumed = consumeDishes(lines, i + 1);
				if (consumed.dishes.length > 0) {
					out.dishes = consumed.dishes;
					const favg = averageDishRatings(consumed.dishes);
					if (favg != null) {
						out.foodRating = favg;
						usedAreaRatings = true;
					}
					i = consumed.next - 1;
					notesStart = consumed.next;
				}
				continue;
			}
			notesStart = i;
			break;
		}
		seenStructural = true;
		notesStart = i + 1;
		const label = m[1].toLowerCase();
		const value = m[2].trim();

		if (label === 'with') {
			out.companions = value || null;
			continue;
		}
		if (label === 'rating') {
			const ratingMatch = value.match(/(\d+(?:\.\d+)?)/);
			if (ratingMatch) parsedRating = Number(ratingMatch[1]);
			if (/\(avg\)/i.test(value)) isAvgRating = true;
			continue;
		}
		if (label === 'attributes') {
			out.attributeOverrides = parseOverrideLine(value);
			continue;
		}
		// vibe/food/quality/service
		const stars = countStars(value);
		const textAfter = value.replace(/[★☆]+\s*/, '').replace(/^—\s*/, '').trim();
		const text = textAfter.length > 0 ? textAfter : null;
		if (stars > 0) usedAreaRatings = true;
		const ratingKey = `${label}Rating` as 'vibeRating' | 'foodRating' | 'qualityRating' | 'serviceRating';
		out[ratingKey] = stars > 0 ? stars : null;
		const textKey = label as 'vibe' | 'food' | 'quality' | 'service';
		out[textKey] = text;

		if (label === 'food') {
			// Dishes that follow the Food line are the source of truth for the
			// food rating.
			const consumed = consumeDishes(lines, i + 1);
			if (consumed.dishes.length > 0) {
				out.dishes = consumed.dishes;
				const favg = averageDishRatings(consumed.dishes);
				if (favg != null) {
					out.foodRating = favg;
					usedAreaRatings = true;
				}
				i = consumed.next - 1;
				notesStart = consumed.next;
			}
		}
	}

	if (!usedAreaRatings && !isAvgRating) {
		out.rating = parsedRating;
	}

	// Everything after the structural block — strip trailing image lines.
	const tail = lines.slice(notesStart);
	while (tail.length > 0) {
		const last = tail[tail.length - 1].trim();
		if (last === '' || /^!\[[^\]]*\]\([^)]+\)\s*$/.test(last)) {
			tail.pop();
		} else {
			break;
		}
	}
	while (tail.length > 0 && tail[0].trim() === '') tail.shift();
	const notesText = tail
		.filter((l) => !/^!\[[^\]]*\]\([^)]+\)\s*$/.test(l.trim()))
		.join('\n')
		.trim();
	out.notes = notesText.length > 0 ? notesText : null;

	return out;
}

export type VisitSummaryEntry = {
	date: string;
	meal: string | null;
	rating: number | null;
	photo: string | null;
};

export type VisitSummary = {
	count: number;
	latest: VisitSummaryEntry | null;
	earliest: VisitSummaryEntry | null;
	average: number | null;
};

function deriveVisitRating(fields: ParsedVisitFields): number | null {
	if (typeof fields.rating === 'number' && fields.rating > 0) return fields.rating;
	const areas = [fields.vibeRating, fields.foodRating, fields.qualityRating, fields.serviceRating]
		.filter((n): n is number => typeof n === 'number' && n > 0);
	if (areas.length === 0) return null;
	return Math.round((areas.reduce((a, b) => a + b, 0) / areas.length) * 10) / 10;
}

export function summarizeVisits(visits: ParsedVisit[]): VisitSummary {
	if (visits.length === 0) {
		return { count: 0, latest: null, earliest: null, average: null };
	}
	const enriched = visits.map((v) => {
		const fields = parseVisitFields(v);
		return {
			date: v.date,
			meal: v.meal,
			rating: deriveVisitRating(fields),
			photo: v.photoPaths[0] ?? null
		};
	});
	const sorted = [...enriched].sort((a, b) => a.date.localeCompare(b.date));
	const withRating = sorted.filter((e) => e.rating !== null);
	const avg = withRating.length > 0
		? Math.round((withRating.reduce((s, e) => s + (e.rating as number), 0) / withRating.length) * 10) / 10
		: null;
	return {
		count: sorted.length,
		earliest: sorted[0],
		latest: sorted[sorted.length - 1],
		average: avg
	};
}

export function summarizeBody(body: string): VisitSummary {
	const { visitsSection } = splitBodyAtVisits(body);
	const visits = parseVisits(visitsSection);
	return summarizeVisits(visits);
}

/**
 * Find the [start, end) byte offsets of the i-th visit block (including the
 * trailing blank line between it and the next ### header).
 */
function visitBlockRange(body: string, index: number): { start: number; end: number } {
	const headerMatch = body.match(/^## Visits\s*$/m);
	if (!headerMatch || headerMatch.index === undefined) {
		throw new Error('No ## Visits section');
	}
	const sectionStart = headerMatch.index + headerMatch[0].length;
	const sectionTail = body.slice(sectionStart);
	const nextHeading = sectionTail.search(/^## \S/m);
	const sectionEnd = nextHeading < 0 ? body.length : sectionStart + nextHeading;
	const section = body.slice(sectionStart, sectionEnd);
	const headers = [...section.matchAll(/^### (.+)$/gm)];
	if (index < 0 || index >= headers.length) {
		throw new Error(`Visit index ${index} out of range (have ${headers.length})`);
	}
	const start = sectionStart + headers[index].index!;
	const end =
		index + 1 < headers.length ? sectionStart + headers[index + 1].index! : sectionEnd;
	return { start, end };
}

export function updateVisitInBody(body: string, index: number, visit: VisitInput): string {
	const { start, end } = visitBlockRange(body, index);
	const newBlock = visitBlock(visit);
	const trailingNewlines = body.slice(start, end).match(/\n*$/)?.[0] ?? '\n';
	return body.slice(0, start) + newBlock.replace(/\n+$/, '') + trailingNewlines + body.slice(end);
}

export function removeVisitFromBody(body: string, index: number): string {
	const { start, end } = visitBlockRange(body, index);
	const head = body.slice(0, start).replace(/\n+$/, '\n');
	const tail = body.slice(end).replace(/^\n+/, '');
	return head + (tail ? '\n' + tail : '');
}

export type ShareFormat = 'full' | 'notes_only';

const STRUCT_FIELD_RE = /^\*\*(With|Vibe|Food|Quality|Service|Rating):/i;

/**
 * Render a parsed visit as plain text suitable for pasting into Google Maps'
 * review composer or attaching to a share sheet message.
 */
export function formatVisitForShare(
	visit: ParsedVisit,
	restaurantName: string,
	format: ShareFormat
): string {
	const headerLine = `${restaurantName} — ${visit.headline}`;
	const lines = visit.rawMarkdown
		.replace(/^### .*\n?/, '')
		.replace(IMAGE_PATTERN, '')
		.split('\n');

	const kept: string[] = [];
	for (const raw of lines) {
		const line = raw.replace(/ {2,}$/, '');
		if (format === 'notes_only' && STRUCT_FIELD_RE.test(line.trim())) continue;
		if (format === 'notes_only' && DISH_LINE_RE.test(line.trim())) continue;
		kept.push(line);
	}

	const cleaned = kept
		.join('\n')
		// Strip bold/italic markers — composer fields are plain text
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
		// Collapse runs of blank lines
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	return cleaned.length > 0 ? `${headerLine}\n\n${cleaned}` : headerLine;
}

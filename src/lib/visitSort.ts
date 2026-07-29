/**
 * Client-facing shape for one visit in the home "Visits" feed. Kept free of any
 * `$lib/server` import so the home page can use it without pulling server-only
 * code into the browser bundle; the server query maps its rows into this shape.
 */
export type VisitFeedItem = {
	restaurantUuid: string;
	restaurantName: string;
	suburb: string | null;
	index: number;
	date: string;
	meal: string | null;
	overallRating: number | null;
	vibeRating: number | null;
	foodRating: number | null;
	qualityRating: number | null;
	serviceRating: number | null;
	notesExcerpt: string | null;
	photo: string | null;
};

export type VisitSortMode =
	| 'recent'
	| 'oldest'
	| 'az'
	| 'za'
	| 'overall_desc'
	| 'overall_asc'
	| 'food_desc'
	| 'food_asc'
	| 'quality_desc'
	| 'quality_asc'
	| 'service_desc'
	| 'service_asc'
	| 'vibe_desc'
	| 'vibe_asc';

export const DEFAULT_VISIT_SORT: VisitSortMode = 'recent';

/** Options for the home-page sort `<select>`, in display order. */
export const VISIT_SORT_OPTIONS: { value: VisitSortMode; label: string }[] = [
	{ value: 'recent', label: 'Recently visited' },
	{ value: 'oldest', label: 'Oldest first' },
	{ value: 'az', label: 'Restaurant A–Z' },
	{ value: 'za', label: 'Restaurant Z–A' },
	{ value: 'overall_desc', label: 'Rating: high → low' },
	{ value: 'overall_asc', label: 'Rating: low → high' },
	{ value: 'food_desc', label: 'Food: high → low' },
	{ value: 'food_asc', label: 'Food: low → high' },
	{ value: 'quality_desc', label: 'Quality: high → low' },
	{ value: 'quality_asc', label: 'Quality: low → high' },
	{ value: 'service_desc', label: 'Service: high → low' },
	{ value: 'service_asc', label: 'Service: low → high' },
	{ value: 'vibe_desc', label: 'Vibe: high → low' },
	{ value: 'vibe_asc', label: 'Vibe: low → high' }
];

const VALID_MODES = new Set<string>(VISIT_SORT_OPTIONS.map((o) => o.value));

export function isVisitSortMode(value: unknown): value is VisitSortMode {
	return typeof value === 'string' && VALID_MODES.has(value);
}

type RatingKey = 'overallRating' | 'foodRating' | 'qualityRating' | 'serviceRating' | 'vibeRating';

const RATING_MODES: Record<string, { key: RatingKey; dir: 'asc' | 'desc' }> = {
	overall_desc: { key: 'overallRating', dir: 'desc' },
	overall_asc: { key: 'overallRating', dir: 'asc' },
	food_desc: { key: 'foodRating', dir: 'desc' },
	food_asc: { key: 'foodRating', dir: 'asc' },
	quality_desc: { key: 'qualityRating', dir: 'desc' },
	quality_asc: { key: 'qualityRating', dir: 'asc' },
	service_desc: { key: 'serviceRating', dir: 'desc' },
	service_asc: { key: 'serviceRating', dir: 'asc' },
	vibe_desc: { key: 'vibeRating', dir: 'desc' },
	vibe_asc: { key: 'vibeRating', dir: 'asc' }
};

/** Which area chip (if any) the active sort emphasises. */
export function activeRatingArea(
	mode: VisitSortMode
): 'overall' | 'food' | 'quality' | 'service' | 'vibe' | null {
	const r = RATING_MODES[mode];
	if (!r) return null;
	return r.key.replace('Rating', '') as 'overall' | 'food' | 'quality' | 'service' | 'vibe';
}

function byName(a: VisitFeedItem, b: VisitFeedItem): number {
	return a.restaurantName.localeCompare(b.restaurantName, undefined, { sensitivity: 'base' });
}

function byDateDescThenName(a: VisitFeedItem, b: VisitFeedItem): number {
	const d = b.date.localeCompare(a.date);
	return d !== 0 ? d : byName(a, b);
}

/**
 * Return a new array sorted by `mode`. Rating sorts always push un-rated visits
 * to the bottom (regardless of direction) and tie-break by most-recent date.
 */
export function sortVisits(items: VisitFeedItem[], mode: VisitSortMode): VisitFeedItem[] {
	const out = [...items];
	const rating = RATING_MODES[mode];

	if (rating) {
		out.sort((a, b) => {
			const av = a[rating.key];
			const bv = b[rating.key];
			const aNull = av == null;
			const bNull = bv == null;
			if (aNull && bNull) return byDateDescThenName(a, b);
			if (aNull) return 1; // nulls last
			if (bNull) return -1;
			if (av !== bv) return rating.dir === 'desc' ? bv - av : av - bv;
			return byDateDescThenName(a, b);
		});
		return out;
	}

	switch (mode) {
		case 'oldest':
			out.sort((a, b) => {
				const d = a.date.localeCompare(b.date);
				return d !== 0 ? d : byName(a, b);
			});
			break;
		case 'az':
			out.sort((a, b) => {
				const n = byName(a, b);
				return n !== 0 ? n : b.date.localeCompare(a.date);
			});
			break;
		case 'za':
			out.sort((a, b) => {
				const n = byName(b, a);
				return n !== 0 ? n : b.date.localeCompare(a.date);
			});
			break;
		case 'recent':
		default:
			out.sort(byDateDescThenName);
			break;
	}
	return out;
}

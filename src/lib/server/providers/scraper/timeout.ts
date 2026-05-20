import { politeFetch } from './fetcher';
import {
	absoluteUrl,
	findJsonLd,
	ldAddress,
	ldGeo,
	ldString,
	parseHtml,
	truncate
} from './parser';
import type {
	ExtractedRestaurant,
	SourceAdapter,
	SourceCity,
	SourceListing
} from './types';

const BASE = 'https://www.timeout.com';

const CITIES: SourceCity[] = [
	{ id: 'melbourne', label: 'Melbourne' },
	{ id: 'sydney', label: 'Sydney' },
	{ id: 'brisbane', label: 'Brisbane' },
	{ id: 'perth', label: 'Perth' },
	{ id: 'adelaide', label: 'Adelaide' }
];

const VALID_CITIES = new Set(CITIES.map((c) => c.id));

// Time Out URLs we handle:
//   /{city}/restaurants/{slug}       — individual restaurant page or editorial list
//   /{city}/restaurants-cafes/{slug} — same, alt section
//   /{city}/bars/{slug}              — bar listings
// We accept the URL shape and then reject editorial-list slugs (e.g.
// "the-best-cafes-in-melbourne"), which share the path pattern but aren't
// single venues.
const INDIVIDUAL_PATH_RE =
	/^\/([a-z-]+)\/(restaurants(?:-cafes)?|bars)\/[a-z0-9-]+\/?$/i;

// Slug patterns that mark a Time Out editorial *list* (top-10, guide,
// roundup, etc.) rather than a single venue. These are heuristics — the
// directory page filtering uses star-rating markup as a more accurate signal.
const LIST_SLUG_PATTERNS = [
	/^the-best-/i,
	/^best-/i,
	/-guide(-|$)/i,
	/-restaurants(-|$)/i,
	/-cafes(-|$)/i,
	/-bars(-|$)/i,
	/-in-melbourne$/i,
	/-in-sydney$/i,
	/-in-brisbane$/i,
	/-in-perth$/i,
	/-in-adelaide$/i,
	/-roundup$/i,
	/^top-/i
];

function slugLooksLikeList(slug: string): boolean {
	return LIST_SLUG_PATTERNS.some((re) => re.test(slug));
}

function matchesUrl(url: string): boolean {
	try {
		const u = new URL(url);
		if (!/(^|\.)timeout\.com$/i.test(u.host)) return false;
		const m = u.pathname.match(INDIVIDUAL_PATH_RE);
		if (!m) return false;
		const city = m[1].toLowerCase();
		if (!VALID_CITIES.has(city)) return false;
		const slug = u.pathname.split('/').filter(Boolean).pop() ?? '';
		if (slugLooksLikeList(slug)) return false;
		return true;
	} catch {
		return false;
	}
}

/**
 * Time Out's JSON-LD address uses `addressLocality` for the state (e.g.
 * "Victoria"), not the suburb. The actual suburb sits in a `<dd>` under the
 * "Address" `<dt>` in the visible page body — usually as `[street, suburb,
 * city, postcode]`. This walks that block and returns the suburb slot.
 */
export function suburbFromDtBlock($: ReturnType<typeof parseHtml>['$']): string | null {
	let suburb: string | null = null;
	$('dt').each((_, el) => {
		const label = $(el).text().trim().toLowerCase().replace(/[:\s]+$/, '');
		if (label !== 'address') return;
		const dds: string[] = [];
		let node = $(el).next();
		while (node.length > 0 && node[0].type === 'tag' && node[0].tagName.toLowerCase() === 'dd') {
			dds.push(node.text().trim());
			node = node.next();
		}
		// Expect [street, suburb, city, postcode] — take the 2nd entry.
		// If only one or two entries exist, suburb may be the last text-only one.
		if (dds.length >= 2) {
			const candidate = dds[1];
			if (candidate && !/^\d/.test(candidate) && candidate.length < 80) {
				suburb = candidate;
			}
		}
		// Stop after the first Address block we hit.
		return false;
	});
	return suburb;
}

export function titleFromSlug(url: string): string {
	try {
		const slug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
		return slug
			.split('-')
			.filter(Boolean)
			.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
			.join(' ');
	} catch {
		return url;
	}
}

/**
 * Strip the "<Name> <Suburb> review: ★★★★★" pattern Time Out uses for review
 * pages so the saved restaurant name doesn't keep the rating glyphs.
 */
function cleanTitle(t: string, suburb: string | null): string {
	let cleaned = t
		.replace(/\s*review:?\s*[★☆\*✭✩]+\s*$/i, '')
		.replace(/\s*\|\s*Time Out.*$/i, '')
		.trim();
	if (suburb) {
		// "Kokoras Yarraville" → "Kokoras"
		const re = new RegExp(`\\s+${suburb}\\s*$`, 'i');
		cleaned = cleaned.replace(re, '').trim();
	}
	return cleaned;
}

async function extract(url: string): Promise<ExtractedRestaurant> {
	if (!matchesUrl(url)) {
		throw new Error('URL does not look like a Time Out restaurant review');
	}
	const html = await politeFetch(url);
	const { $, jsonLd, og, canonicalUrl } = parseHtml(html);

	// Time Out review pages have a single Review JSON-LD node with the actual
	// Restaurant data nested under itemReviewed. We unwrap it first so the
	// rest of the parser can treat it like a top-level Restaurant.
	const reviewNode = findJsonLd(jsonLd, ['Review']);
	const nestedRestaurant =
		reviewNode && typeof reviewNode.itemReviewed === 'object' && reviewNode.itemReviewed !== null
			? (reviewNode.itemReviewed as Record<string, unknown>)
			: null;
	const restaurantNode =
		findJsonLd(jsonLd, [
			'Restaurant',
			'FoodEstablishment',
			'LocalBusiness',
			'CafeOrCoffeeShop',
			'BarOrPub',
			'Bakery'
		]) ??
		nestedRestaurant ??
		findJsonLd(jsonLd, ['NewsArticle', 'Article', 'WebPage']);

	const ldName = ldString(restaurantNode, 'name', 'headline');
	const ldDescription =
		ldString(reviewNode, 'reviewBody') ?? ldString(restaurantNode, 'description', 'articleBody');
	const ldImageVal = restaurantNode?.image;
	const ldImage = typeof ldImageVal === 'string' ? ldImageVal : null;

	const suburb = suburbFromDtBlock($);
	const addressLd = ldAddress(restaurantNode);
	const geo = ldGeo(restaurantNode);

	// Build a clean address string. Time Out's JSON-LD addressLocality is the
	// state, so don't trust ldAddress's "suburb" — use ours.
	const street = addressLd.street;
	const fullAddress = [street, suburb].filter(Boolean).join(', ') || addressLd.full;

	const rawTitle =
		$('h1').first().text().trim() || og['og:title'] || ldName || titleFromSlug(url);
	const name = cleanTitle(rawTitle, suburb);
	const excerpt = truncate(
		og['og:description'] ?? og['twitter:description'] ?? ldDescription ?? null,
		220
	);
	const image = absoluteUrl(og['og:image'] ?? ldImage ?? null, url);
	const published =
		ldString(reviewNode, 'datePublished', 'dateModified') ??
		ldString(restaurantNode, 'datePublished', 'dateModified') ??
		null;

	// The Restaurant `url` field on Time Out is the venue's own website (great).
	// Don't trust the Review.url — that's the Time Out page itself.
	const website =
		typeof restaurantNode?.url === 'string' && /^https?:\/\//i.test(restaurantNode.url as string)
			? (restaurantNode.url as string)
			: null;

	return {
		source: 'timeout',
		url: canonicalUrl ? absoluteUrl(canonicalUrl, url) ?? url : url,
		title: rawTitle,
		name,
		excerpt,
		address: fullAddress && fullAddress.length > 0 ? fullAddress : null,
		suburb,
		lat: geo.lat,
		lng: geo.lng,
		phone: ldString(restaurantNode, 'telephone'),
		website,
		cuisine: cuisineFromLd(restaurantNode),
		image_url: image,
		published_at: published
	};
}

function cuisineFromLd(node: Record<string, unknown> | null): string[] {
	if (!node) return [];
	const cuisine = (node.servesCuisine ?? node.cuisine) as unknown;
	if (typeof cuisine === 'string') return [cuisine.trim()].filter(Boolean);
	if (Array.isArray(cuisine)) {
		return cuisine.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
	}
	return [];
}

/**
 * Scrape the city's `/restaurants-cafes` index and return only tiles that
 * Time Out has rated (i.e. individual restaurant reviews). Editorial roundups
 * are filtered out by checking for the "out of 5 stars" sr-only label that
 * Time Out renders on its rating star widgets.
 */
async function discoverByCity(city: string): Promise<SourceListing[]> {
	if (!VALID_CITIES.has(city)) throw new Error(`Unknown Time Out city: ${city}`);
	const html = await politeFetch(`${BASE}/${city}/restaurants-cafes`);
	return parseDirectoryTiles(html, city);
}

export function parseDirectoryTiles(html: string, city: string): SourceListing[] {
	const { $ } = parseHtml(html);
	const detailRe = new RegExp(`^/${city}/(?:restaurants(?:-cafes)?|bars)/[a-z0-9-]+/?$`, 'i');
	const seen = new Set<string>();
	const out: SourceListing[] = [];

	$('article').each((_, el) => {
		const tile = $(el);
		const html = tile.html() ?? '';
		// Individual-restaurant tiles carry a star-rating widget; editorial
		// roundups do not. This is the most reliable signal in the markup.
		if (!/out of 5 stars/i.test(html)) return;

		const anchor = tile.find('a[href]').first();
		const href = anchor.attr('href');
		if (!href) return;
		const full = absoluteUrl(href, BASE);
		if (!full) return;
		let path: string;
		try {
			path = new URL(full).pathname;
		} catch {
			return;
		}
		if (!detailRe.test(path)) return;
		const slug = path.split('/').filter(Boolean).pop() ?? '';
		if (slugLooksLikeList(slug)) return;
		if (seen.has(full)) return;
		seen.add(full);

		const summary = tile.find('[data-testid="summary_testID"]').first().text().trim();
		const title =
			tile.find('h3, h4, h2').first().text().trim() ||
			anchor.attr('title') ||
			titleFromSlug(full);
		const img =
			tile.find('img').first().attr('src') ??
			tile.find('source[srcset]').first().attr('srcset')?.split(',')[0].trim().split(' ')[0] ??
			null;
		const imageUrl = img ? absoluteUrl(img, BASE) : null;

		out.push({
			source: 'timeout',
			url: full,
			title: cleanTitle(title, null),
			excerpt: truncate(summary || null, 220),
			image_url: imageUrl,
			suburb: null // not present on Time Out directory cards
		});
	});

	return out.slice(0, 60);
}

export const timeout: SourceAdapter = {
	id: 'timeout',
	label: 'Time Out',
	cities: CITIES,
	suburbBrowsable: false,
	cityBrowsable: true,
	matchesUrl,
	extract,
	discoverByCity
};

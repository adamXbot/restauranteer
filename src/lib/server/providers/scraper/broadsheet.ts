import { politeFetch } from './fetcher';
import { absoluteUrl, findJsonLd, ldAddress, ldGeo, ldString, parseHtml, truncate } from './parser';
import type {
	ExtractedRestaurant,
	SourceAdapter,
	SourceCity,
	SourceListing,
	SourceSuburb
} from './types';

const BASE = 'https://www.broadsheet.com.au';

const CITIES: SourceCity[] = [
	{ id: 'melbourne', label: 'Melbourne' },
	{ id: 'sydney', label: 'Sydney' },
	{ id: 'brisbane', label: 'Brisbane' },
	{ id: 'perth', label: 'Perth' },
	{ id: 'adelaide', label: 'Adelaide' }
];

const VALID_CITIES = new Set(CITIES.map((c) => c.id));

// Broadsheet URL patterns we accept:
//   /{city}/food-and-drink/article/{slug}              — news article ("blog")
//   /{city}/{restaurants|cafes|bars}/{slug}            — legacy directory entry
//   /{city}/{suburb}/{restaurants|cafes|bars}/{slug}   — current canonical directory entry
const ARTICLE_PATTERN = /^\/([a-z-]+)\/food-and-drink\/article\/[a-z0-9-]+\/?$/i;
const DIRECTORY_LEGACY_PATTERN =
	/^\/([a-z-]+)\/(restaurants|cafes|bars)\/[a-z0-9-]+\/?$/i;
const DIRECTORY_WITH_SUBURB_PATTERN =
	/^\/([a-z-]+)\/([a-z-]+)\/(restaurants|cafes|bars)\/[a-z0-9-]+\/?$/i;

function matchesUrl(url: string): boolean {
	try {
		const u = new URL(url);
		if (!/(^|\.)broadsheet\.com\.au$/i.test(u.host)) return false;
		return (
			ARTICLE_PATTERN.test(u.pathname) ||
			DIRECTORY_LEGACY_PATTERN.test(u.pathname) ||
			DIRECTORY_WITH_SUBURB_PATTERN.test(u.pathname)
		);
	} catch {
		return false;
	}
}

function isArticleUrl(url: string): boolean {
	try {
		return ARTICLE_PATTERN.test(new URL(url).pathname);
	} catch {
		return false;
	}
}

function isDirectoryUrl(url: string): boolean {
	try {
		const p = new URL(url).pathname;
		return DIRECTORY_LEGACY_PATTERN.test(p) || DIRECTORY_WITH_SUBURB_PATTERN.test(p);
	} catch {
		return false;
	}
}

const DIRECTORY_CATEGORIES = ['restaurants', 'cafes', 'bars'] as const;

function slugifySuburb(input: string): string {
	return input
		.toLowerCase()
		.trim()
		.replace(/[\s_]+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function suburbLabel(slug: string): string {
	return slug
		.split('-')
		.filter(Boolean)
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join(' ');
}

/**
 * Path segments at `/{city}/{slug}` that aren't suburbs. The directory page
 * mixes a few non-suburb links into the same URL shape (category pages,
 * editorial sections), so we explicitly exclude them here.
 */
const NON_SUBURB_SLUGS = new Set<string>([
	...DIRECTORY_CATEGORIES,
	'directory',
	'food-and-drink',
	'shopping',
	'arts',
	'culture',
	'design',
	'fashion',
	'travel',
	'things-to-do',
	'guides',
	'news',
	'best-of',
	'maps',
	'newsletter',
	'series'
]);

/**
 * Harvest the suburb slugs Broadsheet uses in a given city by scraping that
 * city's `/directory` index, which lists every suburb Broadsheet has covered.
 * Broadsheet doesn't publish a stable API for this — implementations of
 * `listSuburbs` are expected to be tolerant of partial data.
 */
export async function listSuburbs(city: string): Promise<SourceSuburb[]> {
	if (!VALID_CITIES.has(city)) throw new Error(`Unknown Broadsheet city: ${city}`);
	let html: string;
	try {
		html = await politeFetch(`${BASE}/${city}/directory`);
	} catch {
		return [];
	}
	return parseSuburbsFromDirectoryHtml(city, html);
}

export function parseSuburbsFromDirectoryHtml(city: string, html: string): SourceSuburb[] {
	const { $ } = parseHtml(html);
	const slugRe = new RegExp(`^/${city}/([a-z0-9][a-z0-9-]*)/?$`, 'i');
	const slugs = new Set<string>();

	$('a[href]').each((_, el) => {
		const href = $(el).attr('href');
		if (!href) return;
		const full = absoluteUrl(href, BASE);
		if (!full) return;
		let path: string;
		try {
			path = new URL(full).pathname;
		} catch {
			return;
		}
		const m = path.match(slugRe);
		if (!m) return;
		const slug = m[1].toLowerCase();
		if (NON_SUBURB_SLUGS.has(slug)) return;
		slugs.add(slug);
	});

	return Array.from(slugs)
		.sort()
		.map((slug) => ({ slug, label: suburbLabel(slug) }));
}

async function discoverBySuburb(city: string, suburb: string): Promise<SourceListing[]> {
	if (!VALID_CITIES.has(city)) throw new Error(`Unknown Broadsheet city: ${city}`);
	const slug = slugifySuburb(suburb);
	if (!slug) throw new Error('Suburb required');
	const label = suburbLabel(slug);

	const seen = new Set<string>();
	const listings: SourceListing[] = [];

	for (const category of DIRECTORY_CATEGORIES) {
		const directoryUrl = `${BASE}/${city}/${slug}/${category}`;
		let html: string;
		try {
			html = await politeFetch(directoryUrl);
		} catch {
			// 404s for an unknown suburb/category — skip, try the next category.
			continue;
		}
		const { $ } = parseHtml(html);
		const detailRe = new RegExp(`^/${city}/${slug}/${category}/[a-z0-9-]+/?$`, 'i');

		$('a[href]').each((_, el) => {
			const href = $(el).attr('href');
			if (!href) return;
			const fullUrl = absoluteUrl(href, BASE);
			if (!fullUrl) return;
			let path: string;
			try {
				path = new URL(fullUrl).pathname;
			} catch {
				return;
			}
			if (!detailRe.test(path)) return;
			if (seen.has(fullUrl)) return;
			seen.add(fullUrl);

			const card = $(el).closest('[data-slot="card"], article, li, div').first();
			const cardEl = card[0] ?? el;
			const cardTitle =
				textOf($, cardEl, '[data-slot="card-title"] h1, [data-slot="card-title"] h2, [data-slot="card-title"] h3, [data-slot="card-title"] h4, [data-slot="card-title"] h5, [data-slot="card-title"] h6, .card-title') ??
				$(card).find('img').first().attr('alt') ??
				$(el).attr('title') ??
				titleFromSlug(fullUrl);
			const excerpt =
				textOf($, cardEl, '[data-slot="card-description"]') ??
				textOf($, cardEl, '[class*="dek"], [class*="standfirst"], [class*="excerpt"]');
			const img =
				$(card).find('img').first().attr('src') ??
				$(card).find('img').first().attr('data-src') ??
				$(card).find('img').first().attr('data-lazy-src') ??
				null;
			const imageUrl = img ? absoluteUrl(img, BASE) : null;

			listings.push({
				source: 'broadsheet',
				url: fullUrl,
				title: cleanTitle(cardTitle),
				excerpt: truncate(excerpt, 220),
				image_url: imageUrl,
				suburb: label
			});
		});
	}

	return listings.slice(0, 60);
}

async function extract(url: string): Promise<ExtractedRestaurant> {
	if (!matchesUrl(url)) {
		throw new Error('URL does not look like a Broadsheet article');
	}
	const html = await politeFetch(url);
	const { $, jsonLd, og, canonicalUrl } = parseHtml(html);

	const restaurantNode =
		findJsonLd(jsonLd, [
			'Restaurant',
			'FoodEstablishment',
			'LocalBusiness',
			'CafeOrCoffeeShop',
			'BarOrPub',
			'Bakery'
		]) ?? findJsonLd(jsonLd, ['NewsArticle', 'Article', 'WebPage']);

	const ldName = ldString(restaurantNode, 'name', 'headline');
	const ldDescription = ldString(restaurantNode, 'description', 'articleBody');
	const ldImage = imageFromLd(restaurantNode);

	const address = ldAddress(restaurantNode);
	const geo = ldGeo(restaurantNode);

	const title = $('h1').first().text().trim() || og['og:title'] || ldName || titleFromSlug(url);
	const name = cleanTitle(title);
	const excerpt = truncate(
		og['og:description'] ?? og['twitter:description'] ?? ldDescription ?? null,
		220
	);
	const image = absoluteUrl(og['og:image'] ?? ldImage ?? null, url);
	const suburb = address.suburb ?? suburbFromUrl(url);
	const published = ldString(restaurantNode, 'datePublished', 'dateModified') ?? null;

	const hydrated = extractContactDetailsFromHydration(html);

	return {
		source: 'broadsheet',
		url: canonicalUrl ? absoluteUrl(canonicalUrl, url) ?? url : url,
		title,
		name,
		excerpt,
		address: address.full,
		suburb,
		lat: geo.lat,
		lng: geo.lng,
		phone: hydrated.phone ?? ldString(restaurantNode, 'telephone'),
		website: hydrated.website ?? ldString(restaurantNode, 'sameAs'),
		cuisine: cuisineFromLd(restaurantNode),
		image_url: image,
		published_at: published
	};
}

// The "Contact Details" h3 on Broadsheet directory pages is hydrated
// client-side from a Next.js streaming chunk; the rendered <div> is empty in
// the static HTML, so we read the venue phone/website out of the chunk.
// JSON-LD `url` is deliberately not used as a fallback — it points at the
// Broadsheet page itself, which we already store as an article source.
export function extractContactDetailsFromHydration(html: string): {
	phone: string | null;
	website: string | null;
} {
	const m = html.match(
		/\\"phone\\":\\"(.*?)\\",\\"website\\":\\"(.*?)\\",\\"title\\":\\".*?\\",\\"region\\":/
	);
	if (!m) return { phone: null, website: null };
	const phone = unescapeChunkString(m[1]);
	const website = unescapeChunkString(m[2]);
	return {
		phone: phone || null,
		website: website && /^https?:\/\//i.test(website) ? website : null
	};
}

function unescapeChunkString(s: string): string {
	return s
		.replace(/\\u002[fF]/g, '/')
		.replace(/\\\//g, '/')
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\')
		.trim();
}

function textOf(
	$: ReturnType<typeof parseHtml>['$'],
	root: unknown,
	selector: string
): string | null {
	if (!root) return null;
	const matched = $(root as never).find(selector).first();
	const text = matched.text().trim();
	return text.length > 0 ? text : null;
}

function titleFromSlug(url: string): string {
	try {
		const path = new URL(url).pathname.split('/').filter(Boolean);
		const slug = path[path.length - 1];
		return slug
			.split('-')
			.filter(Boolean)
			.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
			.join(' ');
	} catch {
		return url;
	}
}

function suburbFromUrl(url: string): string | null {
	try {
		const m = new URL(url).pathname.match(DIRECTORY_WITH_SUBURB_PATTERN);
		if (!m) return null;
		const slug = m[2];
		return slug
			.split('-')
			.filter(Boolean)
			.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
			.join(' ');
	} catch {
		return null;
	}
}

function cleanTitle(t: string): string {
	// Broadsheet restaurant page titles look like:
	//   "{Name} | {Cuisine} | {Area} | {City} | Broadsheet {City}"
	// Take everything up to the first separator.
	const firstSep = t.search(/\s+[|–—]\s+/);
	const base = firstSep > 0 ? t.slice(0, firstSep) : t;
	return base.replace(/\s+/g, ' ').trim();
}

function imageFromLd(node: Record<string, unknown> | null): string | null {
	if (!node) return null;
	const img = node.image;
	if (typeof img === 'string') return img;
	if (Array.isArray(img) && img.length > 0) {
		const first = img[0];
		if (typeof first === 'string') return first;
		if (first && typeof first === 'object' && typeof (first as { url?: unknown }).url === 'string')
			return (first as { url: string }).url;
	}
	if (img && typeof img === 'object' && typeof (img as { url?: unknown }).url === 'string') {
		return (img as { url: string }).url;
	}
	return null;
}

function cuisineFromLd(node: Record<string, unknown> | null): string[] {
	if (!node) return [];
	const cuisine = node.servesCuisine ?? node.cuisine;
	if (typeof cuisine === 'string') return [cuisine.trim()].filter(Boolean);
	if (Array.isArray(cuisine)) {
		return cuisine.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
	}
	return [];
}

export const broadsheet: SourceAdapter = {
	id: 'broadsheet',
	label: 'Broadsheet',
	cities: CITIES,
	suburbBrowsable: true,
	cityBrowsable: false,
	matchesUrl,
	discoverBySuburb,
	listSuburbs,
	extract
};

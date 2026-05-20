import { politeFetch } from './fetcher';
import { absoluteUrl, findJsonLd, ldAddress, ldGeo, ldString, parseHtml, truncate } from './parser';
import type { ExtractedRestaurant, SourceAdapter, SourceCity } from './types';

// Good Food was folded into the SMH/Age "goodfood" section. We only import
// single-restaurant reviews from the Good Food Guide — these live under
// /goodfood/{state}-good-food-guide/{slug}-{id}.html. General /goodfood/
// articles (recipes, listicles, news) get rejected because their title isn't
// the restaurant name and they often don't review a single venue.

const CITIES: SourceCity[] = [
	{ id: 'melbourne', label: 'Melbourne' },
	{ id: 'sydney', label: 'Sydney' }
];

const GUIDE_PATH_RE = /^\/goodfood\/[a-z]{2,4}-good-food-guide\/[a-z0-9-]+-\d{6,}-[a-z0-9]+\.html$/i;

function matchesUrl(url: string): boolean {
	try {
		const u = new URL(url);
		if (/(^|\.)smh\.com\.au$/i.test(u.host) || /(^|\.)theage\.com\.au$/i.test(u.host)) {
			return /^\/goodfood\//i.test(u.pathname);
		}
		if (/(^|\.)goodfood\.com\.au$/i.test(u.host)) {
			return /\/eat-out\//i.test(u.pathname);
		}
		return false;
	} catch {
		return false;
	}
}

export function isGuideReviewUrl(url: string): boolean {
	try {
		const u = new URL(url);
		if (
			!/(^|\.)smh\.com\.au$/i.test(u.host) &&
			!/(^|\.)theage\.com\.au$/i.test(u.host)
		) {
			return false;
		}
		return GUIDE_PATH_RE.test(u.pathname);
	} catch {
		return false;
	}
}

async function extract(url: string): Promise<ExtractedRestaurant> {
	if (!matchesUrl(url)) {
		throw new Error('URL does not look like a Good Food article');
	}
	if (!isGuideReviewUrl(url)) {
		throw new Error(
			'Only Good Food Guide single-restaurant reviews are supported. ' +
				'Try a URL under /vic-good-food-guide/ or /nsw-good-food-guide/ — ' +
				'general Good Food articles (recipes, listicles, news) don\'t have reliable restaurant metadata.'
		);
	}
	const html = await politeFetch(url);
	const { $, jsonLd, og, canonicalUrl } = parseHtml(html);

	const ldNode =
		findJsonLd(jsonLd, [
			'Restaurant',
			'FoodEstablishment',
			'LocalBusiness',
			'CafeOrCoffeeShop',
			'BarOrPub',
			'Bakery'
		]) ??
		findJsonLd(jsonLd, ['Review']) ??
		findJsonLd(jsonLd, ['NewsArticle', 'Article', 'WebPage']);

	const reviewItem = ldReviewItem(ldNode);

	const ldName = ldString(reviewItem, 'name') ?? ldString(ldNode, 'name', 'headline');
	const ldDescription =
		ldString(reviewItem, 'description') ?? ldString(ldNode, 'description', 'articleBody');
	const ldImage = imageFromLd(reviewItem) ?? imageFromLd(ldNode);

	const reviewAddress = ldAddress(reviewItem);
	const fallbackAddress = ldAddress(ldNode);
	const address = reviewAddress.full ? reviewAddress : fallbackAddress;
	const reviewGeo = ldGeo(reviewItem);
	const geo = reviewGeo.lat != null ? reviewGeo : ldGeo(ldNode);

	const title = $('h1').first().text().trim() || og['og:title'] || ldName || titleFromSlug(url);
	const name = cleanTitle(title);
	const excerpt = truncate(
		og['og:description'] ?? og['twitter:description'] ?? ldDescription ?? null,
		220
	);
	const image = absoluteUrl(og['og:image'] ?? ldImage ?? null, url);
	const published = ldString(ldNode, 'datePublished', 'dateModified');

	return {
		source: 'goodfood',
		url: canonicalUrl ? absoluteUrl(canonicalUrl, url) ?? url : url,
		title,
		name,
		excerpt,
		address: address.full,
		suburb: address.suburb,
		lat: geo.lat,
		lng: geo.lng,
		phone: ldString(reviewItem, 'telephone') ?? ldString(ldNode, 'telephone'),
		website: ldString(reviewItem, 'url') ?? ldString(ldNode, 'sameAs'),
		cuisine: cuisineFromLd(reviewItem ?? ldNode),
		image_url: image,
		published_at: published
	};
}

function ldReviewItem(node: Record<string, unknown> | null): Record<string, unknown> | null {
	if (!node) return null;
	const item = node.itemReviewed;
	if (item && typeof item === 'object' && !Array.isArray(item)) {
		return item as Record<string, unknown>;
	}
	return null;
}

function titleFromSlug(url: string): string {
	try {
		const path = new URL(url).pathname.split('/').filter(Boolean);
		let slug = path[path.length - 1].replace(/\.html$/, '');
		slug = slug.replace(/-\d{6,}-[a-z0-9]+$/i, '');
		return slug
			.split('-')
			.filter(Boolean)
			.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
			.join(' ');
	} catch {
		return url;
	}
}

function cleanTitle(t: string): string {
	return t
		.replace(/\s*[|–—-]\s*Good\s*Food.*$/i, '')
		.replace(/\s*[|–—-]\s*The\s*(Age|SMH|Sydney\s*Morning\s*Herald).*$/i, '')
		.replace(/\s+/g, ' ')
		.trim();
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

export const goodfood: SourceAdapter = {
	id: 'goodfood',
	label: 'Good Food',
	cities: CITIES,
	suburbBrowsable: false,
	cityBrowsable: false,
	matchesUrl,
	extract
};

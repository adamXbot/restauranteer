import { politeFetch } from './fetcher';
import { absoluteUrl, findJsonLd, ldAddress, ldGeo, ldString, parseHtml, truncate } from './parser';
import type { ExtractedRestaurant, SourceAdapter, SourceCity } from './types';

// AGFG URL pattern: /restaurant/{slug}-{numeric-id}
// Some entries use /bar/, /cafe/ — accept those too.
const URL_PATTERN = /^\/(restaurant|cafe|bar)\/[a-z0-9-]+-\d{4,}$/i;

const CITIES: SourceCity[] = [];

function matchesUrl(url: string): boolean {
	try {
		const u = new URL(url);
		if (!/(^|\.)agfg\.com\.au$/i.test(u.host)) return false;
		return URL_PATTERN.test(u.pathname);
	} catch {
		return false;
	}
}

async function extract(url: string): Promise<ExtractedRestaurant> {
	if (!matchesUrl(url)) throw new Error('URL does not look like an AGFG listing');
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
		]) ?? findJsonLd(jsonLd, ['BreadcrumbList']);

	const address = ldAddress(restaurantNode);
	const geo = ldGeo(restaurantNode);
	const ldName = ldString(restaurantNode, 'name');
	const ldDescription = ldString(restaurantNode, 'description');
	const ldImage = imageFromLd(restaurantNode);

	const h1 = $('h1').first().text().trim();
	const title = og['og:title'] || h1 || ldName || 'AGFG listing';
	const name = h1 || cleanTitle(ldName ?? title);
	const excerpt = truncate(og['og:description'] ?? ldDescription ?? null, 220);
	const image = absoluteUrl(og['og:image'] ?? ldImage ?? null, url);

	return {
		source: 'agfg',
		url: canonicalUrl ? absoluteUrl(canonicalUrl, url) ?? url : url,
		title,
		name,
		excerpt,
		address: address.full,
		suburb: address.suburb,
		lat: geo.lat,
		lng: geo.lng,
		phone: ldString(restaurantNode, 'telephone'),
		website: ldString(restaurantNode, 'url'),
		cuisine: cuisineFromLd(restaurantNode),
		image_url: image,
		published_at: null
	};
}

function cleanTitle(t: string): string {
	return t
		.replace(/\s*[|–—-]\s*AGFG.*$/i, '')
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

export const agfg: SourceAdapter = {
	id: 'agfg',
	label: 'AGFG',
	cities: CITIES,
	suburbBrowsable: false,
	cityBrowsable: false,
	matchesUrl,
	extract
};

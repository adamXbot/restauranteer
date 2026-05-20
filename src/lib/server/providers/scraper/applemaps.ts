import { politeFetchWithMeta } from './fetcher';
import { absoluteUrl, parseHtml, truncate } from './parser';
import type { ExtractedRestaurant, SourceAdapter, SourceCity } from './types';

// Apple Maps URL shapes we accept:
//   https://maps.apple/p/<id>                       — share short URL (redirects to the canonical place URL)
//   https://maps.apple.com/place?name=&address=&…   — canonical place URL
//   https://maps.apple.com/?q=&ll=&…                — legacy share URL
//   https://beta.maps.apple.com/…                   — beta host, same query layout
const SHORT_HOST = 'maps.apple';
const FULL_HOSTS = new Set(['maps.apple.com', 'beta.maps.apple.com']);

const CITIES: SourceCity[] = [];

function matchesUrl(rawUrl: string): boolean {
	try {
		const u = new URL(rawUrl);
		if (u.host === SHORT_HOST) return u.pathname.startsWith('/p/');
		return FULL_HOSTS.has(u.host);
	} catch {
		return false;
	}
}

async function extract(rawUrl: string): Promise<ExtractedRestaurant> {
	if (!matchesUrl(rawUrl)) {
		throw new Error('URL does not look like an Apple Maps link');
	}

	const { text: html, finalUrl } = await politeFetchWithMeta(rawUrl);
	const { og } = parseHtml(html);

	// After redirect, Apple bakes name/address/coordinate/place-id into the URL.
	const params = safeSearchParams(finalUrl);
	const paramName = params.get('name')?.trim() ?? null;
	const paramAddress = params.get('address')?.trim() ?? null;
	const coordinate = params.get('coordinate') ?? params.get('ll');
	const placeId = params.get('place-id');

	const { lat, lng } = parseCoordinate(coordinate);

	const entity = extractBusinessEntity(html);

	const name = paramName ?? og['og:title']?.trim() ?? 'Apple Maps place';
	const address = paramAddress;
	const image = absoluteUrl(og['og:image'] ?? null, finalUrl);
	const excerpt = truncate(address, 220);

	return {
		source: 'applemaps',
		url: placeId ? canonicalUrl(finalUrl, params) : finalUrl,
		title: name,
		name,
		excerpt,
		address,
		suburb: suburbFromAddress(address),
		lat,
		lng,
		phone: entity.phone,
		website: entity.website,
		cuisine: entity.categories,
		image_url: image,
		published_at: null
	};
}

function safeSearchParams(url: string): URLSearchParams {
	try {
		return new URL(url).searchParams;
	} catch {
		return new URLSearchParams();
	}
}

function parseCoordinate(raw: string | null): { lat: number | null; lng: number | null } {
	if (!raw) return { lat: null, lng: null };
	const [latStr, lngStr] = raw.split(',');
	const lat = Number.parseFloat(latStr ?? '');
	const lng = Number.parseFloat(lngStr ?? '');
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: null, lng: null };
	return { lat, lng };
}

/**
 * Build a stable canonical URL from the place params. Apple's rendered redirect
 * may add `map=explore` or similar UI state; we strip it so the same place
 * always produces the same stored URL.
 */
function canonicalUrl(finalUrl: string, params: URLSearchParams): string {
	try {
		const out = new URL(finalUrl);
		const keep = new URLSearchParams();
		for (const k of ['name', 'address', 'coordinate', 'place-id']) {
			const v = params.get(k);
			if (v) keep.set(k, v);
		}
		out.search = keep.toString();
		return out.toString();
	} catch {
		return finalUrl;
	}
}

/**
 * Apple Maps embeds a JSON blob describing the BUSINESS entity with telephone,
 * url, and a localizedCategory list. We pull phone/website/categories out via
 * tight regexes — the full blob is huge and we only need a handful of fields.
 */
export function extractBusinessEntity(html: string): {
	phone: string | null;
	website: string | null;
	categories: string[];
} {
	const entityIdx = html.indexOf('"type":"BUSINESS"');
	if (entityIdx < 0) return { phone: null, website: null, categories: [] };

	// Restrict matching to the ~4KB window after the BUSINESS marker so we don't
	// accidentally pick fields from a different result block.
	const window = html.slice(entityIdx, entityIdx + 4096);

	const phoneMatch = window.match(/"telephone":"([^"]+)"/);
	const urlMatch = window.match(/"url":"((?:[^"\\]|\\.)*)"/);
	const categories = Array.from(
		window.matchAll(
			/"localizedName":\[\{"locale":"[^"]+","stringValue":"((?:[^"\\]|\\.)*)"\}\]/g
		)
	).map((m) => unescapeJson(m[1]));

	return {
		phone: phoneMatch ? unescapeJson(phoneMatch[1]) : null,
		website: urlMatch && /^https?:\/\//i.test(urlMatch[1]) ? unescapeJson(urlMatch[1]) : null,
		categories: dedupe(categories.filter((c) => c && c !== 'Dining'))
	};
}

function unescapeJson(s: string): string {
	return s
		.replace(/\\"/g, '"')
		.replace(/\\\//g, '/')
		.replace(/\\\\/g, '\\')
		.trim();
}

function dedupe(xs: string[]): string[] {
	return Array.from(new Set(xs));
}

function suburbFromAddress(address: string | null): string | null {
	if (!address) return null;
	// Apple's address format is "<street>, <suburb> <STATE> <postcode>, <country>"
	const parts = address.split(',').map((s) => s.trim());
	if (parts.length < 2) return null;
	const second = parts[1];
	const m = second.match(/^(.+?)\s+(VIC|NSW|QLD|WA|SA|TAS|NT|ACT)/i);
	return m ? m[1] : null;
}

export const applemaps: SourceAdapter = {
	id: 'applemaps',
	label: 'Apple Maps',
	cities: CITIES,
	suburbBrowsable: false,
	cityBrowsable: false,
	matchesUrl,
	extract
};

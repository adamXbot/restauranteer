import * as cheerio from 'cheerio';

export type ParsedDocument = {
	$: cheerio.CheerioAPI;
	jsonLd: JsonLdNode[];
	og: Record<string, string>;
	canonicalUrl: string | null;
};

type JsonLdNode = Record<string, unknown>;

export function parseHtml(html: string): ParsedDocument {
	const $ = cheerio.load(html);

	const jsonLd: JsonLdNode[] = [];
	$('script[type="application/ld+json"]').each((_, el) => {
		const text = $(el).text().trim();
		if (!text) return;
		try {
			const parsed = JSON.parse(text);
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					if (item && typeof item === 'object') jsonLd.push(item as JsonLdNode);
				}
			} else if (parsed && typeof parsed === 'object') {
				const graph = (parsed as Record<string, unknown>)['@graph'];
				if (Array.isArray(graph)) {
					for (const item of graph) {
						if (item && typeof item === 'object') jsonLd.push(item as JsonLdNode);
					}
				} else {
					jsonLd.push(parsed as JsonLdNode);
				}
			}
		} catch {
			// invalid JSON-LD — skip
		}
	});

	const og: Record<string, string> = {};
	$('meta[property^="og:"], meta[name^="twitter:"]').each((_, el) => {
		const key = ($(el).attr('property') ?? $(el).attr('name') ?? '').toLowerCase();
		const value = $(el).attr('content');
		if (key && value) og[key] = value;
	});

	const canonical = $('link[rel="canonical"]').attr('href') ?? null;

	return { $, jsonLd, og, canonicalUrl: canonical };
}

export function findJsonLd<T extends string>(
	jsonLd: JsonLdNode[],
	types: T[]
): JsonLdNode | null {
	const lookup = new Set(types.map((t) => t.toLowerCase()));
	for (const node of jsonLd) {
		const t = node['@type'];
		if (typeof t === 'string' && lookup.has(t.toLowerCase())) return node;
		if (Array.isArray(t) && t.some((x) => typeof x === 'string' && lookup.has(x.toLowerCase()))) {
			return node;
		}
	}
	return null;
}

export function ldString(node: JsonLdNode | null, ...keys: string[]): string | null {
	if (!node) return null;
	for (const k of keys) {
		const v = node[k];
		if (typeof v === 'string' && v.trim().length > 0) return v.trim();
		if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	}
	return null;
}

const SUBURB_ABBREVS = new Set(['CBD', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT']);

function normalizeSuburb(s: string): string {
	const trimmed = s.trim();
	if (!trimmed) return trimmed;
	const upper = trimmed.toUpperCase();
	if (SUBURB_ABBREVS.has(upper)) return upper;
	// Title-case if it looks like a single-word lowercase ("Cbd" → "CBD" handled above, "fitzroy" → "Fitzroy")
	return trimmed
		.split(/\s+/)
		.map((w) => {
			const wu = w.toUpperCase();
			if (SUBURB_ABBREVS.has(wu)) return wu;
			return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
		})
		.join(' ');
}

export function ldAddress(node: JsonLdNode | null): {
	street: string | null;
	suburb: string | null;
	full: string | null;
} {
	if (!node) return { street: null, suburb: null, full: null };
	const raw = node.address;
	if (!raw) return { street: null, suburb: null, full: null };
	if (typeof raw === 'string') return { street: null, suburb: null, full: raw };
	if (typeof raw === 'object') {
		const a = raw as Record<string, unknown>;
		const street = typeof a.streetAddress === 'string' ? a.streetAddress.trim() : null;
		const suburbRaw = typeof a.addressLocality === 'string' ? a.addressLocality.trim() : null;
		const suburb = suburbRaw ? normalizeSuburb(suburbRaw) : null;
		const region = typeof a.addressRegion === 'string' ? a.addressRegion.trim() : null;
		const postal = typeof a.postalCode === 'string' ? a.postalCode.trim() : null;
		const full = [street, suburb, region, postal].filter(Boolean).join(', ');
		return { street, suburb, full: full.length > 0 ? full : null };
	}
	return { street: null, suburb: null, full: null };
}

export function ldGeo(node: JsonLdNode | null): { lat: number | null; lng: number | null } {
	if (!node) return { lat: null, lng: null };
	const geo = node.geo;
	if (geo && typeof geo === 'object') {
		const g = geo as Record<string, unknown>;
		const lat = Number(g.latitude);
		const lng = Number(g.longitude);
		if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
	}
	return { lat: null, lng: null };
}

export function truncate(text: string | null, maxLen = 220): string | null {
	if (!text) return null;
	const cleaned = text.replace(/\s+/g, ' ').trim();
	if (cleaned.length <= maxLen) return cleaned;
	return cleaned.slice(0, maxLen - 1).trim() + '…';
}

export function absoluteUrl(href: string | null, baseUrl: string): string | null {
	if (!href) return null;
	try {
		return new URL(href, baseUrl).toString();
	} catch {
		return null;
	}
}

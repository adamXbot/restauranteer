import { politeFetch } from './fetcher';
import { parseHtml, truncate } from './parser';
import type { ArticleRef } from './types';

type HostMatch = { match: RegExp; source: string; label: string };

// Order matters — first match wins. Add new known hosts here so they get a
// friendly label and a stable source slug across imports.
const HOST_SOURCES: HostMatch[] = [
	{ match: /(^|\.)timeout\.com$/i, source: 'timeout', label: 'Time Out' },
	{ match: /(^|\.)instagram\.com$/i, source: 'instagram', label: 'Instagram' },
	{ match: /(^|\.)tiktok\.com$/i, source: 'tiktok', label: 'TikTok' },
	{ match: /(^|\.)reddit\.com$/i, source: 'reddit', label: 'Reddit' },
	{ match: /^redd\.it$/i, source: 'reddit', label: 'Reddit' },
	{ match: /(^|\.)tripadvisor\.[a-z.]+$/i, source: 'tripadvisor', label: 'TripAdvisor' },
	{ match: /(^|\.)youtube\.com$/i, source: 'youtube', label: 'YouTube' },
	{ match: /^youtu\.be$/i, source: 'youtube', label: 'YouTube' },
	{ match: /(^|\.)facebook\.com$/i, source: 'facebook', label: 'Facebook' },
	{ match: /^fb\.(com|me)$/i, source: 'facebook', label: 'Facebook' },
	{ match: /(^|\.)yelp\.com(\.au)?$/i, source: 'yelp', label: 'Yelp' },
	{ match: /(^|\.)theurbanlist\.com$/i, source: 'urbanlist', label: 'The Urban List' },
	{ match: /(^|\.)concreteplayground\.com$/i, source: 'concreteplayground', label: 'Concrete Playground' }
];

export function detectLinkSource(url: string): { source: string; label: string } {
	try {
		const host = new URL(url).host.toLowerCase();
		for (const h of HOST_SOURCES) {
			if (h.match.test(host)) return { source: h.source, label: h.label };
		}
		const bare = host.replace(/^www\./, '');
		const root = bare.split('.')[0] || 'link';
		return { source: root, label: titleCase(root) };
	} catch {
		return { source: 'link', label: 'Link' };
	}
}

function titleCase(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function titleFromUrl(url: string, fallbackLabel: string): string {
	try {
		const u = new URL(url);
		const segments = u.pathname.split('/').filter(Boolean);
		for (let i = segments.length - 1; i >= 0; i--) {
			const seg = decodeURIComponent(segments[i]).replace(/\.\w{2,5}$/, '');
			// Skip purely numeric / id-looking segments (TikTok video ids, Reddit IDs, etc.)
			if (/^[\d_-]+$/.test(seg)) continue;
			const words = seg.replace(/[-_+]+/g, ' ').trim();
			if (words.length > 1) return titleCase(words);
		}
		return `${fallbackLabel} link`;
	} catch {
		return 'Link';
	}
}

/**
 * Build an ArticleRef for any URL by reading its OpenGraph / Twitter card
 * metadata. Resilient: if the fetch or parse fails (login walls on
 * Instagram/TikTok, blocked scrapers, no metadata), the link is still saved
 * with a hostname-derived label and a slug-derived title.
 */
export async function extractGenericLink(url: string): Promise<ArticleRef> {
	const preview = await extractGenericLinkPreview(url);
	return preview.ref;
}

export type GenericLinkPreview = {
	ref: ArticleRef;
	image_url: string | null;
};

export async function extractGenericLinkPreview(url: string): Promise<GenericLinkPreview> {
	const { source, label } = detectLinkSource(url);
	let title: string | null = null;
	let excerpt: string | null = null;
	let image_url: string | null = null;
	try {
		const html = await politeFetch(url);
		const { og } = parseHtml(html);
		const t = (og['og:title'] ?? og['twitter:title'] ?? '').trim();
		if (t) title = t;
		const d = (og['og:description'] ?? og['twitter:description'] ?? '').trim();
		if (d) excerpt = truncate(d, 220);
		const img = (og['og:image'] ?? og['twitter:image'] ?? '').trim();
		if (img && /^https?:\/\//i.test(img)) image_url = img;
	} catch {
		// Couldn't scrape (auth wall, blocked, network). Still save the link.
	}
	return {
		ref: {
			source,
			url,
			title: title ?? titleFromUrl(url, label),
			excerpt,
			fetched_at: new Date().toISOString()
		},
		image_url
	};
}

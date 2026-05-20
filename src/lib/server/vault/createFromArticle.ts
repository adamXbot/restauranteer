import { newId } from '../uuid';
import { findByArticleUrl, getRestaurantByUuid } from '../db/queries';
import { readRestaurant } from './reader';
import { resolveCollisionFreePath } from './filename';
import { saveRestaurant } from './save';
import { CURRENT_SCHEMA_VERSION, type Frontmatter } from './types';
import type { ArticleRef, ExtractedRestaurant } from '../providers/scraper/types';

const SOURCE_LABEL: Record<string, string> = {
	broadsheet: 'Broadsheet',
	goodfood: 'Good Food',
	agfg: 'AGFG',
	applemaps: 'Apple Maps'
};

export type CreateFromArticleResult = {
	uuid: string;
	filePath: string;
	alreadyExisted: boolean;
	articleAdded: boolean;
};

export async function createOrLinkFromArticle(
	article: ExtractedRestaurant
): Promise<CreateFromArticleResult> {
	const sourceLabel = SOURCE_LABEL[article.source] ?? article.source;
	const ref: ArticleRef = {
		source: article.source,
		url: article.url,
		title: article.name || article.title,
		excerpt: article.excerpt,
		fetched_at: new Date().toISOString()
	};

	const existingByUrl = findByArticleUrl(article.url);
	if (existingByUrl) {
		return {
			uuid: existingByUrl.uuid,
			filePath: existingByUrl.file_path,
			alreadyExisted: true,
			articleAdded: false
		};
	}

	const filePath = await resolveCollisionFreePath(
		article.name || article.title,
		article.suburb
	);

	const uuid = newId();
	const frontmatter: Frontmatter = {
		id: uuid,
		schema_version: CURRENT_SCHEMA_VERSION,
		name: article.name || article.title,
		address: article.address ?? undefined,
		suburb: article.suburb ?? undefined,
		lat: article.lat ?? undefined,
		lng: article.lng ?? undefined,
		phone: article.phone ?? undefined,
		website: article.website ?? undefined,
		cuisine: article.cuisine.length > 0 ? article.cuisine : undefined,
		articles: [ref],
		lists: [],
		tags: [],
		last_synced: new Date().toISOString()
	};

	const body = initialBody(article, sourceLabel);
	await saveRestaurant(filePath, frontmatter, body);
	return { uuid, filePath, alreadyExisted: false, articleAdded: true };
}

/** Append a new article reference to an existing restaurant. */
export async function linkArticleToRestaurant(
	uuid: string,
	article: ExtractedRestaurant
): Promise<CreateFromArticleResult> {
	const ref: ArticleRef = {
		source: article.source,
		url: article.url,
		title: article.name || article.title,
		excerpt: article.excerpt,
		fetched_at: new Date().toISOString()
	};
	return linkRefToRestaurant(uuid, ref);
}

/**
 * Append an already-built ArticleRef to an existing restaurant. Used by the
 * generic-link path where there's no `ExtractedRestaurant` — only the link
 * metadata itself (title, excerpt, hostname-derived source).
 */
export async function linkRefToRestaurant(
	uuid: string,
	ref: ArticleRef
): Promise<CreateFromArticleResult> {
	const indexed = getRestaurantByUuid(uuid);
	if (!indexed) throw new Error(`Restaurant ${uuid} not found`);

	const rf = await readRestaurant(indexed.file_path);
	const existing = Array.isArray(rf.frontmatter.articles)
		? (rf.frontmatter.articles as ArticleRef[])
		: [];
	if (existing.some((a) => a.url === ref.url)) {
		return {
			uuid: indexed.uuid,
			filePath: indexed.file_path,
			alreadyExisted: true,
			articleAdded: false
		};
	}

	const newFm: Frontmatter = { ...rf.frontmatter, articles: [...existing, ref] };
	await saveRestaurant(indexed.file_path, newFm, rf.body);
	return {
		uuid: indexed.uuid,
		filePath: indexed.file_path,
		alreadyExisted: true,
		articleAdded: true
	};
}

function initialBody(article: ExtractedRestaurant, sourceLabel: string): string {
	const lines: string[] = ['## Overview', ''];
	if (article.excerpt) {
		lines.push(`**${sourceLabel} says:** ${article.excerpt}`, '');
		lines.push(`[Read the full review →](${article.url})`, '');
	}
	if (article.website) {
		lines.push('## Menu', '', `- [Online menu](${article.website})`, '');
	}
	lines.push('## Visits', '');
	return lines.join('\n');
}

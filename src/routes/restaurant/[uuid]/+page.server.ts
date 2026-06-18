import path from 'node:path';
import { error } from '@sveltejs/kit';
import { marked } from 'marked';
import type { PageServerLoad } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import {
	extractImagePaths,
	formatVisitForShare,
	parseVisits,
	splitBodyAtVisits,
	summarizeVisits
} from '$lib/server/vault/visit';
import { hasGoogleKey, placeDetails } from '$lib/server/providers/google';
import type { PlaceDetails } from '$lib/server/providers/google';
import { config, restaurantsDir } from '$lib/server/config';
import { getPreferences } from '$lib/server/preferences';
import { log } from '$lib/server/log';
import { getAllListSummaries } from '$lib/server/vault/moc';
import { extractRestaurantNotes, removeRestaurantNotesSection } from '$lib/server/vault/notes';
import type { ListMembership } from '$lib/server/vault/types';
import {
	attributeAppliesTo,
	cleanAnswers,
	type AttributeValue
} from '$lib/attributes';

marked.setOptions({ breaks: false, gfm: true });

function preprocessMarkdown(body: string): string {
	return body
		.replace(/!\[([^\]]*)\]\((_attachments\/[^)]+)\)/g, (_, alt, p: string) => {
			const rel = p.slice('_attachments/'.length);
			return `![${alt}](/api/attachments/${rel})`;
		})
		.replace(/\[\[([^\]]+)\]\]/g, (_, name: string) => `*${name}*`);
}

function renderMarkdown(body: string): string {
	if (!body.trim()) return '';
	return marked.parse(preprocessMarkdown(body)) as string;
}

function obsidianUri(filePath: string): string | null {
	if (!config.obsidianVaultName) return null;
	const rel = path.relative(path.dirname(restaurantsDir()), filePath);
	const noExt = rel.replace(/\.md$/, '');
	return `obsidian://open?vault=${encodeURIComponent(config.obsidianVaultName)}&file=${encodeURIComponent(noExt)}`;
}

export const load: PageServerLoad = async ({ params, url }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found in vault');

	const file = await readRestaurant(indexed.file_path).catch(() => null);
	const fm = (file?.frontmatter ?? indexed.frontmatter) as Record<string, unknown>;
	const body = file?.body ?? '';
	const forceRefresh = url.searchParams.get('refresh') === '1';

	let placeDetailsData: PlaceDetails | null = null;
	if (indexed.google_place_id && hasGoogleKey()) {
		try {
			placeDetailsData = await placeDetails(indexed.google_place_id, { forceRefresh });
		} catch (e) {
			log.error('Failed to fetch Google details for vault item', { error: String(e) });
		}
	}

	const userPhotos = extractImagePaths(body).filter((p) => p.startsWith('_attachments/'));
	const bodyHtml = renderMarkdown(body);
	const rawMarkdown = file?.rawContent ?? null;

	// Split the body for per-visit share buttons. The detail page still renders
	// bodyHtml at the bottom as a fallback / for unstructured edits, but the
	// Visits section gets a structured render with a Share button per visit.
	const sections = splitBodyAtVisits(body);
	const parsedVisits = parseVisits(sections.visitsSection);
	const visitSummary = summarizeVisits(parsedVisits);
	const bodyVisits = parsedVisits.map((v) => ({
		id: v.id,
		index: v.index,
		date: v.date,
		meal: v.meal,
		headline: v.headline,
		html: renderMarkdown(v.rawMarkdown),
		photoPaths: v.photoPaths,
		// Dish photos are emitted as indented `  ![](…)` lines; visit-level photos
		// are not indented. Lets the page show the collapse toggle only when relevant.
		hasDishPhotos: /^ {2,}!\[/m.test(v.rawMarkdown),
		shareText: {
			full: formatVisitForShare(v, indexed.name, 'full'),
			notes_only: formatVisitForShare(v, indexed.name, 'notes_only')
		}
	}));
	const bodySections = {
		beforeVisitsHtml: renderMarkdown(removeRestaurantNotesSection(sections.before)),
		visits: bodyVisits,
		afterVisitsHtml: renderMarkdown(removeRestaurantNotesSection(sections.after))
	};
	const notesMarkdown = extractRestaurantNotes(body);
	const listMemberships = Array.isArray(fm.list_memberships)
		? (fm.list_memberships as ListMembership[]).filter(
				(m) => m && typeof m === 'object' && typeof m.list === 'string'
			)
		: [];

	const preferences = getPreferences();
	const restaurantCuisines = Array.isArray(fm.cuisine) ? (fm.cuisine as string[]) : [];
	const scopeTarget = { tags: indexed.tags, cuisines: restaurantCuisines, lists: indexed.lists };
	const applicableAttributes = preferences.attributes.filter((def) =>
		attributeAppliesTo(def, scopeTarget)
	);
	const attributeAnswers = cleanAnswers(fm.attributes as Record<string, AttributeValue> | undefined);

	return {
		uuid: indexed.uuid,
		name: indexed.name,
		filePath: indexed.file_path,
		filename: path.basename(indexed.file_path),
		obsidianUri: obsidianUri(indexed.file_path),
		frontmatter: fm,
		body,
		bodyHtml,
		bodySections,
		notes: {
			markdown: notesMarkdown,
			html: renderMarkdown(notesMarkdown)
		},
		rawMarkdown,
		userPhotos,
		tags: indexed.tags,
		lists: indexed.lists,
		listMemberships,
		availableLists: (await getAllListSummaries()).map((l) => l.name),
		place: placeDetailsData,
		lat: indexed.lat,
		lng: indexed.lng,
		preferences,
		applicableAttributes,
		attributeAnswers,
		visitSummary
	};
};

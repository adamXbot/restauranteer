import path from 'node:path';
import type { RestaurantFile } from '../vault/types';
import { extractVisitsForIndex, summarizeBody, type VisitSummary } from '../vault/visit';
import { getDb } from './schema';

export type IndexedRestaurant = {
	uuid: string;
	file_path: string;
	name: string;
	lat: number | null;
	lng: number | null;
	phone: string | null;
	website: string | null;
	last_synced: string | null;
	mtime: number;
	sha256: string;
	google_place_id: string | null;
	frontmatter: Record<string, unknown>;
	tags: string[];
	lists: string[];
	visitSummary: VisitSummary;
};

type RestaurantRow = {
	uuid: string;
	file_path: string;
	name: string;
	lat: number | null;
	lng: number | null;
	phone: string | null;
	website: string | null;
	last_synced: string | null;
	mtime: number;
	sha256: string;
	frontmatter_json: string;
	body_excerpt: string | null;
	indexed_at: number;
	google_place_id: string | null;
	visit_summary_json: string | null;
};

const EMPTY_SUMMARY: VisitSummary = { count: 0, latest: null, earliest: null, average: null };

function parseSummary(json: string | null): VisitSummary {
	if (!json) return EMPTY_SUMMARY;
	try {
		const parsed = JSON.parse(json) as Partial<VisitSummary>;
		return {
			count: typeof parsed.count === 'number' ? parsed.count : 0,
			latest: parsed.latest ?? null,
			earliest: parsed.earliest ?? null,
			average: typeof parsed.average === 'number' ? parsed.average : null
		};
	} catch {
		return EMPTY_SUMMARY;
	}
}

function extractGooglePlaceId(fm: Record<string, unknown>): string | null {
	const ids = fm.place_ids;
	if (ids && typeof ids === 'object' && 'google' in ids) {
		const id = (ids as Record<string, unknown>).google;
		return typeof id === 'string' && id.length > 0 ? id : null;
	}
	return null;
}

export function upsertRestaurant(rf: RestaurantFile): void {
	const db = getDb();
	const fm = rf.frontmatter;
	const uuid = String(fm.id ?? '');
	if (!uuid) {
		throw new Error(`Restaurant ${rf.filePath} has no id — refusing to index`);
	}
	const bodyExcerpt = rf.body.slice(0, 1000);
	const name = String(fm.name ?? path.basename(rf.filePath, '.md'));

	const upsertMain = db.prepare(`
		INSERT INTO restaurants (
			uuid, file_path, name, lat, lng, phone, website, last_synced,
			mtime, sha256, frontmatter_json, body_excerpt, indexed_at, google_place_id,
			visit_summary_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (uuid) DO UPDATE SET
			file_path = excluded.file_path,
			name = excluded.name,
			lat = excluded.lat,
			lng = excluded.lng,
			phone = excluded.phone,
			website = excluded.website,
			last_synced = excluded.last_synced,
			mtime = excluded.mtime,
			sha256 = excluded.sha256,
			frontmatter_json = excluded.frontmatter_json,
			body_excerpt = excluded.body_excerpt,
			indexed_at = excluded.indexed_at,
			google_place_id = excluded.google_place_id,
			visit_summary_json = excluded.visit_summary_json
	`);
	const deleteTags = db.prepare('DELETE FROM tags WHERE restaurant_uuid = ?');
	const insertTag = db.prepare('INSERT INTO tags (restaurant_uuid, tag) VALUES (?, ?)');
	const deleteLists = db.prepare('DELETE FROM lists WHERE restaurant_uuid = ?');
	const insertList = db.prepare('INSERT INTO lists (restaurant_uuid, list_name) VALUES (?, ?)');
	const deleteVisits = db.prepare('DELETE FROM visits WHERE restaurant_uuid = ?');
	const insertVisit = db.prepare(`
		INSERT INTO visits (
			restaurant_uuid, visit_index, date, meal, overall_rating,
			vibe_rating, food_rating, quality_rating, service_rating, notes_excerpt, photo_path
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);
	const deleteFts = db.prepare('DELETE FROM restaurants_fts WHERE uuid = ?');
	const insertFts = db.prepare(`
		INSERT INTO restaurants_fts (uuid, name, aliases, address, tags, body)
		VALUES (?, ?, ?, ?, ?, ?)
	`);
	// Resolve path conflict: another restaurant might have moved away from this file_path
	const reassignPath = db.prepare(
		'UPDATE restaurants SET file_path = ? WHERE file_path = ? AND uuid != ?'
	);

	db.transaction(() => {
		// If another row holds this file_path, clear it (rename will reindex separately)
		reassignPath.run(`__stale__:${uuid}:${Date.now()}`, rf.filePath, uuid);

		const visitSummary = summarizeBody(rf.body);
		upsertMain.run(
			uuid,
			rf.filePath,
			name,
			typeof fm.lat === 'number' ? fm.lat : null,
			typeof fm.lng === 'number' ? fm.lng : null,
			fm.phone ? String(fm.phone) : null,
			fm.website ? String(fm.website) : null,
			fm.last_synced ? String(fm.last_synced) : null,
			rf.mtime,
			rf.sha256,
			JSON.stringify(fm),
			bodyExcerpt,
			Date.now(),
			extractGooglePlaceId(fm as Record<string, unknown>),
			visitSummary.count > 0 ? JSON.stringify(visitSummary) : null
		);

		deleteTags.run(uuid);
		if (Array.isArray(fm.tags)) {
			for (const tag of fm.tags) insertTag.run(uuid, String(tag));
		}
		deleteLists.run(uuid);
		if (Array.isArray(fm.lists)) {
			for (const listName of fm.lists) insertList.run(uuid, String(listName));
		}

		deleteVisits.run(uuid);
		for (const v of extractVisitsForIndex(rf.body)) {
			insertVisit.run(
				uuid,
				v.index,
				v.date,
				v.meal,
				v.overallRating,
				v.vibeRating,
				v.foodRating,
				v.qualityRating,
				v.serviceRating,
				v.notesExcerpt,
				v.photo
			);
		}

		deleteFts.run(uuid);
		const ftsTags = [
			...(Array.isArray(fm.tags) ? (fm.tags as unknown[]).map(String) : []),
			...(Array.isArray(fm.cuisine) ? (fm.cuisine as unknown[]).map(String) : [])
		].join(' ');
		insertFts.run(
			uuid,
			name,
			Array.isArray(fm.aliases) ? fm.aliases.join(' ') : '',
			fm.address ? String(fm.address) : '',
			ftsTags,
			bodyExcerpt
		);

		db.prepare('DELETE FROM article_urls WHERE restaurant_uuid = ?').run(uuid);
		if (Array.isArray(fm.articles)) {
			const insertArticle = db.prepare(
				'INSERT OR IGNORE INTO article_urls (restaurant_uuid, url, source) VALUES (?, ?, ?)'
			);
			for (const article of fm.articles as Array<Record<string, unknown>>) {
				const url = typeof article?.url === 'string' ? article.url : null;
				const source = typeof article?.source === 'string' ? article.source : 'unknown';
				if (url) insertArticle.run(uuid, url, source);
			}
		}
	})();
}

export function findByArticleUrl(url: string): IndexedRestaurant | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT r.* FROM article_urls a
			 JOIN restaurants r ON r.uuid = a.restaurant_uuid
			 WHERE a.url = ?
			 LIMIT 1`
		)
		.get(url) as RestaurantRow | undefined;
	return row ? hydrate(row) : null;
}

export function deleteRestaurantByPath(filePath: string): string | null {
	const db = getDb();
	const row = db.prepare('SELECT uuid FROM restaurants WHERE file_path = ?').get(filePath) as
		| { uuid: string }
		| undefined;
	if (!row) return null;
	db.transaction(() => {
		db.prepare('DELETE FROM restaurants_fts WHERE uuid = ?').run(row.uuid);
		db.prepare('DELETE FROM restaurants WHERE uuid = ?').run(row.uuid);
	})();
	return row.uuid;
}

export function getAllRestaurants(): IndexedRestaurant[] {
	const db = getDb();
	const rows = db
		.prepare('SELECT * FROM restaurants ORDER BY name COLLATE NOCASE')
		.all() as RestaurantRow[];
	return rows.map((r) => hydrate(r));
}

export type IndexedVisit = {
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

type VisitRow = {
	restaurant_uuid: string;
	restaurant_name: string;
	suburb: string | null;
	visit_index: number;
	date: string;
	meal: string | null;
	overall_rating: number | null;
	vibe_rating: number | null;
	food_rating: number | null;
	quality_rating: number | null;
	service_rating: number | null;
	notes_excerpt: string | null;
	photo_path: string | null;
};

/**
 * Every visit across every restaurant, newest first. Powers the home "Visits"
 * feed; callers re-sort client-side by the chosen mode.
 */
export function getAllVisits(): IndexedVisit[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT v.restaurant_uuid,
			        r.name AS restaurant_name,
			        json_extract(r.frontmatter_json, '$.suburb') AS suburb,
			        v.visit_index,
			        v.date,
			        v.meal,
			        v.overall_rating,
			        v.vibe_rating,
			        v.food_rating,
			        v.quality_rating,
			        v.service_rating,
			        v.notes_excerpt,
			        v.photo_path
			 FROM visits v
			 JOIN restaurants r ON r.uuid = v.restaurant_uuid
			 ORDER BY v.date DESC, r.name COLLATE NOCASE`
		)
		.all() as VisitRow[];
	return rows.map((r) => ({
		restaurantUuid: r.restaurant_uuid,
		restaurantName: r.restaurant_name,
		suburb: typeof r.suburb === 'string' && r.suburb.length > 0 ? r.suburb : null,
		index: r.visit_index,
		date: r.date,
		meal: r.meal,
		overallRating: r.overall_rating,
		vibeRating: r.vibe_rating,
		foodRating: r.food_rating,
		qualityRating: r.quality_rating,
		serviceRating: r.service_rating,
		notesExcerpt: r.notes_excerpt,
		photo: r.photo_path
	}));
}

export function getRestaurantByUuid(uuid: string): IndexedRestaurant | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM restaurants WHERE uuid = ?').get(uuid) as
		| RestaurantRow
		| undefined;
	return row ? hydrate(row) : null;
}

export function getRestaurantByPath(filePath: string): IndexedRestaurant | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM restaurants WHERE file_path = ?').get(filePath) as
		| RestaurantRow
		| undefined;
	return row ? hydrate(row) : null;
}

export function listKnownPaths(): Map<string, string> {
	const db = getDb();
	const rows = db.prepare('SELECT file_path, sha256 FROM restaurants').all() as {
		file_path: string;
		sha256: string;
	}[];
	const out = new Map<string, string>();
	for (const r of rows) out.set(r.file_path, r.sha256);
	return out;
}

export function getDistinctLists(): { name: string; count: number }[] {
	const db = getDb();
	return db
		.prepare(
			'SELECT list_name AS name, COUNT(*) AS count FROM lists GROUP BY list_name ORDER BY list_name COLLATE NOCASE'
		)
		.all() as { name: string; count: number }[];
}

export function getRestaurantNamesForList(listName: string): string[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT r.name FROM lists l
			 JOIN restaurants r ON r.uuid = l.restaurant_uuid
			 WHERE l.list_name = ?
			 ORDER BY r.name COLLATE NOCASE`
		)
		.all(listName) as { name: string }[];
	return rows.map((r) => r.name);
}

function hydrate(r: RestaurantRow): IndexedRestaurant {
	const db = getDb();
	const tagRows = db
		.prepare('SELECT tag FROM tags WHERE restaurant_uuid = ? ORDER BY tag')
		.all(r.uuid) as { tag: string }[];
	const listRows = db
		.prepare('SELECT list_name FROM lists WHERE restaurant_uuid = ? ORDER BY list_name')
		.all(r.uuid) as { list_name: string }[];
	return {
		uuid: r.uuid,
		file_path: r.file_path,
		name: r.name,
		lat: r.lat,
		lng: r.lng,
		phone: r.phone,
		website: r.website,
		last_synced: r.last_synced,
		mtime: r.mtime,
		sha256: r.sha256,
		google_place_id: r.google_place_id ?? null,
		frontmatter: JSON.parse(r.frontmatter_json),
		tags: tagRows.map((t) => t.tag),
		lists: listRows.map((l) => l.list_name),
		visitSummary: parseSummary(r.visit_summary_json)
	};
}

export function searchVaultFts(query: string, limit = 10): IndexedRestaurant[] {
	const db = getDb();
	const cleaned = query.replace(/[^\w\s-]/g, ' ').trim();
	if (!cleaned) return [];
	const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
	if (tokens.length === 0) return [];
	const ftsQuery = tokens.map((t) => `${t}*`).join(' ');
	let rows: RestaurantRow[];
	try {
		rows = db
			.prepare(
				`SELECT r.* FROM restaurants_fts fts
				 JOIN restaurants r ON r.uuid = fts.uuid
				 WHERE restaurants_fts MATCH ?
				 ORDER BY rank
				 LIMIT ?`
			)
			.all(ftsQuery, limit) as RestaurantRow[];
	} catch {
		return [];
	}
	return rows.map((r) => hydrate(r));
}

export function findByGooglePlaceId(placeId: string): IndexedRestaurant | null {
	const db = getDb();
	const row = db
		.prepare('SELECT * FROM restaurants WHERE google_place_id = ?')
		.get(placeId) as RestaurantRow | undefined;
	return row ? hydrate(row) : null;
}

export type NearFilter = {
	minLat: number;
	maxLat: number;
	minLng: number;
	maxLng: number;
	minRating?: number;
	cuisines?: string[]; // case-insensitive substring match against any of these
	tags?: string[]; // must include all of these tags
	lists?: string[]; // must include all of these lists
	attributes?: Record<string, 'yes' | 'no'>; // restaurant frontmatter.attributes.<id> must equal value
};

/**
 * Returns vault restaurants whose lat/lng falls inside the bounding box plus
 * any filter constraints. Caller is responsible for haversine refinement to
 * the exact radius.
 */
export function findRestaurantsInBox(filter: NearFilter): IndexedRestaurant[] {
	const db = getDb();
	const params: (string | number)[] = [filter.minLat, filter.maxLat, filter.minLng, filter.maxLng];
	let sql =
		`SELECT r.* FROM restaurants r
		 WHERE r.lat IS NOT NULL AND r.lng IS NOT NULL
		   AND r.lat BETWEEN ? AND ?
		   AND r.lng BETWEEN ? AND ?`;
	if (typeof filter.minRating === 'number') {
		sql += ` AND CAST(json_extract(r.frontmatter_json, '$.rating') AS REAL) >= ?`;
		params.push(filter.minRating);
	}
	if (filter.tags && filter.tags.length > 0) {
		for (const t of filter.tags) {
			sql += ` AND EXISTS (SELECT 1 FROM tags WHERE restaurant_uuid = r.uuid AND tag = ?)`;
			params.push(t);
		}
	}
	if (filter.lists && filter.lists.length > 0) {
		for (const l of filter.lists) {
			sql += ` AND EXISTS (SELECT 1 FROM lists WHERE restaurant_uuid = r.uuid AND list_name = ?)`;
			params.push(l);
		}
	}
	if (filter.attributes) {
		for (const [id, value] of Object.entries(filter.attributes)) {
			if (value !== 'yes' && value !== 'no') continue;
			// JSON path doesn't allow arbitrary chars; we slugify on write, so the id
			// is always [a-z0-9_]. Still, restrict here as a belt-and-braces guard.
			const safeId = id.replace(/[^a-z0-9_]/gi, '_');
			sql += ` AND json_extract(r.frontmatter_json, '$.attributes.${safeId}') = ?`;
			params.push(value);
		}
	}
	sql += ' LIMIT 1000';

	const rows = db.prepare(sql).all(...params) as RestaurantRow[];
	const hydrated = rows.map((r) => hydrate(r));

	if (filter.cuisines && filter.cuisines.length > 0) {
		const lookup = filter.cuisines.map((c) => c.toLowerCase());
		return hydrated.filter((r) => {
			const cs = (r.frontmatter.cuisine as string[] | undefined) ?? [];
			return cs.some((c) => lookup.includes(c.toLowerCase()));
		});
	}
	return hydrated;
}

export function getDistinctCuisines(): string[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT DISTINCT value AS cuisine
			 FROM restaurants, json_each(json_extract(frontmatter_json, '$.cuisine'))
			 WHERE json_type(frontmatter_json, '$.cuisine') = 'array'
			 ORDER BY value COLLATE NOCASE`
		)
		.all() as { cuisine: string }[];
	return rows.map((r) => r.cuisine).filter(Boolean);
}

export type VaultMatch = {
	restaurant: IndexedRestaurant;
	score: number; // 0..1, higher = stronger match
	distance_m: number | null;
	reason: 'exact_name' | 'name_subset' | 'token_overlap';
};

const STRIP_NOISE = /\b(the|and|&|cafe|cafés?|restaurant|bar|kitchen|co|inc|pty|ltd)\b/gi;

function normalizeName(s: string): string {
	return s
		.toLowerCase()
		.replace(STRIP_NOISE, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function tokenSet(s: string): Set<string> {
	return new Set(s.split(/\s+/).filter((t) => t.length > 1));
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find vault restaurants that might be the same place as the one being imported.
 * Used to suggest a merge instead of creating a duplicate.
 *
 * Matching strategy:
 *  - Exact normalised-name match → high score (1.0)
 *  - One name fully contains the other → 0.85
 *  - Jaccard token overlap ≥ 0.5 → 0.5 + jaccard/2
 *  - Whenever both sides have coords, distance ≤ MAX_DISTANCE_M is required
 *  - Whenever only one side has coords, name match alone is enough
 */
export function findVaultCandidates(
	name: string,
	lat: number | null = null,
	lng: number | null = null,
	limit = 5
): VaultMatch[] {
	const MAX_DISTANCE_M = 500;
	const MIN_JACCARD = 0.5;
	const all = getAllRestaurants();
	const target = normalizeName(name);
	if (!target) return [];
	const targetTokens = tokenSet(target);
	if (targetTokens.size === 0) return [];

	const matches: VaultMatch[] = [];
	for (const r of all) {
		const norm = normalizeName(r.name);
		if (!norm) continue;
		const tokens = tokenSet(norm);
		if (tokens.size === 0) continue;

		let score = 0;
		let reason: VaultMatch['reason'] = 'token_overlap';
		if (norm === target) {
			score = 1.0;
			reason = 'exact_name';
		} else if (norm.includes(target) || target.includes(norm)) {
			score = 0.85;
			reason = 'name_subset';
		} else {
			let intersection = 0;
			for (const t of targetTokens) if (tokens.has(t)) intersection++;
			const union = new Set([...targetTokens, ...tokens]).size;
			const jaccard = union === 0 ? 0 : intersection / union;
			if (jaccard < MIN_JACCARD) continue;
			score = 0.5 + jaccard / 2;
		}

		let distance_m: number | null = null;
		if (lat != null && lng != null && r.lat != null && r.lng != null) {
			distance_m = haversineKm(lat, lng, r.lat, r.lng) * 1000;
			if (distance_m > MAX_DISTANCE_M) continue;
			// Closer matches get a small score bump (up to 0.1)
			score += 0.1 * (1 - distance_m / MAX_DISTANCE_M);
		}

		matches.push({ restaurant: r, score: Math.min(score, 1), distance_m, reason });
	}

	matches.sort((a, b) => b.score - a.score);
	return matches.slice(0, limit);
}

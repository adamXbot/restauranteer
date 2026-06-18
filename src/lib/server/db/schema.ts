import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { dbPath } from '../config';
import { log } from '../log';

let db: Database.Database | null = null;

const MIGRATIONS: string[] = [
	// v1 — initial schema
	`
	CREATE TABLE IF NOT EXISTS restaurants (
		uuid TEXT PRIMARY KEY,
		file_path TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		lat REAL,
		lng REAL,
		phone TEXT,
		website TEXT,
		last_synced TEXT,
		mtime INTEGER NOT NULL,
		sha256 TEXT NOT NULL,
		frontmatter_json TEXT NOT NULL,
		body_excerpt TEXT,
		indexed_at INTEGER NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_restaurants_name ON restaurants(name);
	CREATE INDEX IF NOT EXISTS idx_restaurants_geo ON restaurants(lat, lng);

	CREATE VIRTUAL TABLE IF NOT EXISTS restaurants_fts USING fts5(
		uuid UNINDEXED,
		name,
		aliases,
		address,
		tags,
		body,
		tokenize='unicode61'
	);

	CREATE TABLE IF NOT EXISTS tags (
		restaurant_uuid TEXT NOT NULL REFERENCES restaurants(uuid) ON DELETE CASCADE,
		tag TEXT NOT NULL,
		PRIMARY KEY (restaurant_uuid, tag)
	);

	CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

	CREATE TABLE IF NOT EXISTS lists (
		restaurant_uuid TEXT NOT NULL REFERENCES restaurants(uuid) ON DELETE CASCADE,
		list_name TEXT NOT NULL,
		PRIMARY KEY (restaurant_uuid, list_name)
	);

	CREATE INDEX IF NOT EXISTS idx_lists_name ON lists(list_name);

	CREATE TABLE IF NOT EXISTS api_cache (
		provider TEXT NOT NULL,
		cache_key TEXT NOT NULL,
		payload_json TEXT NOT NULL,
		fetched_at INTEGER NOT NULL,
		ttl_seconds INTEGER NOT NULL,
		PRIMARY KEY (provider, cache_key)
	);

	CREATE TABLE IF NOT EXISTS photo_url_cache (
		restaurant_uuid TEXT NOT NULL,
		source_id TEXT NOT NULL,
		signed_url TEXT NOT NULL,
		expires_at INTEGER NOT NULL,
		PRIMARY KEY (restaurant_uuid, source_id)
	);

	CREATE TABLE IF NOT EXISTS meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	`,
	// v2 — explicit google_place_id column for fast vault dedup on search
	`
	ALTER TABLE restaurants ADD COLUMN google_place_id TEXT;
	CREATE INDEX IF NOT EXISTS idx_restaurants_google_place_id ON restaurants(google_place_id);
	`,
	// v3 — denormalized article URLs for fast dedup when importing from sources
	`
	CREATE TABLE IF NOT EXISTS article_urls (
		restaurant_uuid TEXT NOT NULL REFERENCES restaurants(uuid) ON DELETE CASCADE,
		url TEXT NOT NULL,
		source TEXT NOT NULL,
		PRIMARY KEY (restaurant_uuid, url)
	);
	CREATE INDEX IF NOT EXISTS idx_article_urls_url ON article_urls(url);
	`,
	// v4 — link inbox for pending URLs that aren't attached to a restaurant yet
	`
	CREATE TABLE IF NOT EXISTS link_inbox (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		url TEXT NOT NULL UNIQUE,
		source TEXT NOT NULL,
		title TEXT NOT NULL,
		excerpt TEXT,
		image_url TEXT,
		suggested_uuid TEXT,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_inbox_created ON link_inbox(created_at DESC);
	`,
	// v5 — cached per-restaurant visit summary (latest/earliest/avg + first thumb)
	// so the vault list can show review state without re-parsing every body.
	`
	ALTER TABLE restaurants ADD COLUMN visit_summary_json TEXT;
	`,
	// v6 — per-visit index so a cross-restaurant visit feed can sort by date,
	// restaurant name, or any area rating without re-parsing every body. Rows
	// are (re)populated in upsertRestaurant, so the full-reconcile on boot
	// backfills existing vaults with no separate migration step.
	`
	CREATE TABLE IF NOT EXISTS visits (
		restaurant_uuid TEXT NOT NULL REFERENCES restaurants(uuid) ON DELETE CASCADE,
		visit_index INTEGER NOT NULL,
		date TEXT NOT NULL,
		meal TEXT,
		overall_rating REAL,
		vibe_rating REAL,
		food_rating REAL,
		quality_rating REAL,
		service_rating REAL,
		notes_excerpt TEXT,
		photo_path TEXT,
		PRIMARY KEY (restaurant_uuid, visit_index)
	);
	CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(date);
	`
];

export function getDb(): Database.Database {
	if (db) return db;
	const p = dbPath();
	mkdirSync(path.dirname(p), { recursive: true });
	const handle = new Database(p);
	handle.pragma('journal_mode = WAL');
	handle.pragma('foreign_keys = ON');
	applyMigrations(handle);
	db = handle;
	return handle;
}

function applyMigrations(d: Database.Database) {
	d.exec(`CREATE TABLE IF NOT EXISTS _migrations (
		version INTEGER PRIMARY KEY,
		applied_at INTEGER NOT NULL
	);`);
	const appliedRows = d.prepare('SELECT version FROM _migrations').all() as { version: number }[];
	const applied = new Set(appliedRows.map((r) => r.version));
	for (let i = 0; i < MIGRATIONS.length; i++) {
		const v = i + 1;
		if (applied.has(v)) continue;
		log.info('Applying DB migration', { version: v });
		d.transaction(() => {
			d.exec(MIGRATIONS[i]);
			d.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(v, Date.now());
		})();
	}
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}

export function setMeta(key: string, value: string): void {
	getDb().prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

export function getMeta(key: string): string | null {
	const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

export function deleteMeta(key: string): void {
	getDb().prepare('DELETE FROM meta WHERE key = ?').run(key);
}

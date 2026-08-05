/**
 * The web side of the shared-vault conventions the iOS app introduced:
 * `{vault}/.restauranteer-settings.json` (preferences) and
 * `{vault}/Inbox/*.md` (`kind: restauranteer_inbox` — the phone's inbox
 * store, which the web mirrors and must consume only on triage).
 *
 * Config snapshots VAULT_PATH at import time, so the production modules are
 * imported dynamically after the env is staged (same pattern as
 * tests/sync/tombstone-hooks.test.ts).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type Modules = {
	config: typeof import('../src/lib/server/config');
	preferences: typeof import('../src/lib/server/preferences');
	inbox: typeof import('../src/lib/server/inbox');
	inboxFiles: typeof import('../src/lib/server/vault/inboxFiles');
	schema: typeof import('../src/lib/server/db/schema');
};

let vault: string;
let m: Modules;

function inboxFile(name: string, frontmatter: string): void {
	mkdirSync(path.join(vault, 'Inbox'), { recursive: true });
	writeFileSync(path.join(vault, 'Inbox', name), `---\n${frontmatter}\n---\n`);
}

beforeAll(async () => {
	vault = mkdtempSync(path.join(os.tmpdir(), 'restauranteer-adoption-'));
	process.env.VAULT_PATH = vault;
	process.env.VAULT_SUBDIR = 'Restaurants';
	process.env.LOG_LEVEL = 'error';
	delete process.env.RESTAURANTEER_INDEX_PATH;
	mkdirSync(path.join(vault, 'Restaurants'), { recursive: true });

	const [config, preferences, inbox, inboxFiles, schema] = await Promise.all([
		import('../src/lib/server/config'),
		import('../src/lib/server/preferences'),
		import('../src/lib/server/inbox'),
		import('../src/lib/server/vault/inboxFiles'),
		import('../src/lib/server/db/schema')
	]);
	m = { config, preferences, inbox, inboxFiles, schema };
});

afterAll(() => {
	m?.schema.closeDb();
	rmSync(vault, { recursive: true, force: true });
});

beforeEach(() => {
	rmSync(path.join(vault, 'Inbox'), { recursive: true, force: true });
	rmSync(path.join(vault, '.restauranteer-settings.json'), { force: true });
	m.schema.getDb().prepare('DELETE FROM link_inbox').run();
	m.schema.setMeta('preferences', '');
});

describe('index path override', () => {
	it('honors RESTAURANTEER_INDEX_PATH and defaults inside the vault', () => {
		expect(m.config.dbPath()).toBe(path.join(vault, '.restauranteer', 'index.db'));
		process.env.RESTAURANTEER_INDEX_PATH = '/somewhere/local/index.db';
		expect(m.config.dbPath()).toBe('/somewhere/local/index.db');
		delete process.env.RESTAURANTEER_INDEX_PATH;
	});
});

describe('shared settings file', () => {
	it('reads the vault file over sqlite meta', () => {
		m.schema.setMeta('preferences', JSON.stringify({ per_area_ratings: false }));
		writeFileSync(
			m.config.preferencesFilePath(),
			JSON.stringify({ per_area_ratings: true })
		);
		expect(m.preferences.getPreferences().per_area_ratings).toBe(true);
	});

	it('writes the file on save and carries unknown keys through', () => {
		// A future peer's key must survive a round-trip through this server —
		// the same passthrough rule the iOS store applies in reverse.
		writeFileSync(
			m.config.preferencesFilePath(),
			JSON.stringify({ per_area_ratings: false, ios_only_future_key: { x: 1 } })
		);
		m.preferences.setPreferences({ per_area_ratings: true });

		const written = JSON.parse(readFileSync(m.config.preferencesFilePath(), 'utf8'));
		expect(written.per_area_ratings).toBe(true);
		expect(written.ios_only_future_key).toEqual({ x: 1 });
		// Meta stays in step as the rollback fallback.
		expect(JSON.parse(m.schema.getMeta('preferences')!).per_area_ratings).toBe(true);
	});

	it('adopts meta-stored preferences into the file once', () => {
		m.schema.setMeta('preferences', JSON.stringify({ food_breakdown: true }));
		expect(existsSync(m.config.preferencesFilePath())).toBe(false);
		m.preferences.adoptSettingsFileIfMissing();
		const written = JSON.parse(readFileSync(m.config.preferencesFilePath(), 'utf8'));
		expect(written.food_breakdown).toBe(true);
	});
});

describe('vault inbox adoption', () => {
	const fm = [
		'kind: restauranteer_inbox',
		'schema_version: 1',
		"url: 'https://example.com/great-bakery'",
		'title: Great Bakery',
		'source: instagram',
		"shared_at: '2026-08-01T12:10:29.116Z'"
	].join('\n');

	it('mirrors phone-shared files into the inbox without consuming them', () => {
		inboxFile('20260801-121029-aaaa0001.md', fm);
		const items = m.inbox.listInbox();
		expect(items).toHaveLength(1);
		expect(items[0].url).toBe('https://example.com/great-bakery');
		expect(items[0].title).toBe('Great Bakery');
		expect(items[0].vault_file).toBe('20260801-121029-aaaa0001.md');
		// Reading is not triage: the phone still owns the item.
		expect(existsSync(path.join(vault, 'Inbox', '20260801-121029-aaaa0001.md'))).toBe(true);
		// Idempotent: a second listing adds nothing.
		expect(m.inbox.listInbox()).toHaveLength(1);
	});

	it('dismissing on the web consumes the phone file', () => {
		inboxFile('20260801-121029-aaaa0002.md', fm);
		const item = m.inbox.listInbox()[0];
		expect(m.inbox.dismissInbox(item.id)).toBe(true);
		expect(existsSync(path.join(vault, 'Inbox', '20260801-121029-aaaa0002.md'))).toBe(false);
	});

	it('drops the mirrored row when the phone triaged first', () => {
		inboxFile('20260801-121029-aaaa0003.md', fm);
		expect(m.inbox.listInbox()).toHaveLength(1);
		rmSync(path.join(vault, 'Inbox', '20260801-121029-aaaa0003.md'));
		expect(m.inbox.listInbox()).toHaveLength(0);
	});

	it('maps a duplicate URL onto the existing web row instead of failing UNIQUE', () => {
		m.schema
			.getDb()
			.prepare(
				`INSERT INTO link_inbox (url, source, title, excerpt, image_url, suggested_uuid, created_at)
				 VALUES ('https://example.com/great-bakery', 'web', 'Added here first', NULL, NULL, NULL, 1)`
			)
			.run();
		inboxFile('20260801-121029-aaaa0004.md', fm);
		const items = m.inbox.listInbox();
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('Added here first');
		expect(items[0].vault_file).toBe('20260801-121029-aaaa0004.md');
		// Triaging the web row consumes the phone's file too.
		m.inbox.dismissInbox(items[0].id);
		expect(existsSync(path.join(vault, 'Inbox', '20260801-121029-aaaa0004.md'))).toBe(false);
	});

	it('ignores markdown that is not a pairing of ours', () => {
		inboxFile('notes.md', 'title: Just a note');
		expect(m.inbox.listInbox()).toHaveLength(0);
	});

	it('consumeInboxFile refuses paths that escape Inbox/', () => {
		writeFileSync(path.join(vault, 'precious.md'), 'do not delete');
		m.inboxFiles.consumeInboxFile('../precious.md');
		expect(existsSync(path.join(vault, 'precious.md'))).toBe(true);
	});
});

/**
 * Sync path allowlist. The string layer (`validateSyncPath`) and the
 * filesystem layer (`resolveSyncPath`, which follows symlinks) are tested
 * separately — a string check alone can be defeated by a symlink planted in
 * the vault, which is the whole reason the second layer exists.
 *
 * Config snapshots VAULT_PATH at import time, so the production modules are
 * imported dynamically after the scratch vault is configured.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type PathsModule = typeof import('../../src/lib/server/sync/paths');

let vault: string;
let outside: string;
let paths: PathsModule;

beforeAll(async () => {
	vault = mkdtempSync(path.join(os.tmpdir(), 'restauranteer-paths-'));
	outside = mkdtempSync(path.join(os.tmpdir(), 'restauranteer-outside-'));
	process.env.VAULT_PATH = vault;
	process.env.VAULT_SUBDIR = 'Restaurants';
	process.env.LOG_LEVEL = 'error';

	mkdirSync(path.join(vault, 'Restaurants', '_Lists'), { recursive: true });
	mkdirSync(path.join(vault, 'Restaurants', '_attachments'), { recursive: true });
	mkdirSync(path.join(vault, 'Restaurants', '.restauranteer-tmp'), { recursive: true });
	mkdirSync(path.join(vault, 'Inbox'), { recursive: true });
	mkdirSync(path.join(vault, '.restauranteer'), { recursive: true });
	writeFileSync(path.join(vault, 'info.md'), '# info\n');
	writeFileSync(path.join(vault, '.restauranteer', 'index.db'), 'not really a db');
	writeFileSync(path.join(outside, 'secrets.txt'), 'top secret');

	paths = await import('../../src/lib/server/sync/paths');
});

afterAll(() => {
	rmSync(vault, { recursive: true, force: true });
	rmSync(outside, { recursive: true, force: true });
});

describe('validateSyncPath — accepted', () => {
	const accepted = [
		'Restaurants/Etta.md',
		'Restaurants/nested/deeply/Place.md',
		'Restaurants/_Lists/Brunch.md',
		'Restaurants/_attachments/etta/2026-01-01.jpg',
		'Inbox/2026-07-26-shared-link.md',
		'Inbox/sub/dir/file.md',
		'info.md',
		'.restauranteer-settings.json'
	];

	for (const rel of accepted) {
		it(`accepts ${rel}`, () => {
			expect(paths.validateSyncPath(rel)).toEqual({ ok: true, rel });
		});
	}

	it('trims surrounding whitespace', () => {
		expect(paths.validateSyncPath('  Restaurants/Etta.md  ')).toEqual({
			ok: true,
			rel: 'Restaurants/Etta.md'
		});
	});
});

describe('validateSyncPath — traversal', () => {
	const traversal = [
		'../etc/passwd',
		'Restaurants/../../etc/passwd',
		'Restaurants/../Inbox/x.md',
		'Restaurants/./Etta.md',
		'Restaurants//Etta.md',
		'..'
	];

	for (const rel of traversal) {
		it(`rejects ${rel}`, () => {
			const result = paths.validateSyncPath(rel);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe('traversal');
		});
	}

	it('rejects absolute paths', () => {
		expect(paths.validateSyncPath('/etc/passwd')).toEqual({ ok: false, reason: 'absolute' });
		expect(paths.validateSyncPath('C:/Windows/win.ini')).toEqual({ ok: false, reason: 'absolute' });
	});

	it('rejects backslash separators before they can be normalised away', () => {
		expect(paths.validateSyncPath('Restaurants\\..\\..\\etc\\passwd')).toEqual({
			ok: false,
			reason: 'backslash'
		});
	});

	it('rejects NUL bytes', () => {
		expect(paths.validateSyncPath('Restaurants/Etta.md\0.png')).toEqual({
			ok: false,
			reason: 'nul'
		});
	});

	it('rejects empty and over-long paths', () => {
		expect(paths.validateSyncPath('')).toEqual({ ok: false, reason: 'empty' });
		expect(paths.validateSyncPath(null)).toEqual({ ok: false, reason: 'empty' });
		expect(paths.validateSyncPath(`Restaurants/${'a'.repeat(2000)}.md`)).toEqual({
			ok: false,
			reason: 'too_long'
		});
	});
});

describe('validateSyncPath — dotfiles and non-allowlisted roots', () => {
	const dotfiles = [
		'.restauranteer/index.db',
		'.restauranteer/index.db-wal',
		'Restaurants/.restauranteer-tmp/Etta.md.tmp-1234',
		'Restaurants/.DS_Store',
		'Restaurants/.Etta.md.icloud',
		'.env',
		'.git/config'
	];

	for (const rel of dotfiles) {
		it(`rejects ${rel}`, () => {
			const result = paths.validateSyncPath(rel);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.reason).toBe('dotfile');
		});
	}

	it('permits the settings dotfile only at the vault root', () => {
		expect(paths.validateSyncPath('.restauranteer-settings.json').ok).toBe(true);
		const nested = paths.validateSyncPath('Restaurants/.restauranteer-settings.json');
		expect(nested.ok).toBe(false);
		if (!nested.ok) expect(nested.reason).toBe('dotfile');
	});

	it('rejects unknown roots and bare root files', () => {
		for (const rel of ['Notes/thing.md', 'README.md', 'package.json', 'Restaurants']) {
			const result = paths.validateSyncPath(rel);
			expect(result.ok, `${rel} should be rejected`).toBe(false);
			if (!result.ok) expect(result.reason).toBe('not_allowlisted');
		}
	});
});

describe('resolveSyncPath — real filesystem', () => {
	it('resolves an allowlisted path to an absolute path inside the vault', async () => {
		const result = await paths.resolveSyncPath('Restaurants/Etta.md');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.rel).toBe('Restaurants/Etta.md');
			expect(result.abs).toBe(path.join(vault, 'Restaurants', 'Etta.md'));
		}
	});

	it('allows paths that do not exist yet (creation)', async () => {
		const result = await paths.resolveSyncPath('Restaurants/brand/new/Place.md');
		expect(result.ok).toBe(true);
	});

	it('rejects a symlinked file that escapes the vault', async () => {
		symlinkSync(path.join(outside, 'secrets.txt'), path.join(vault, 'Restaurants', 'escape.md'));
		const result = await paths.resolveSyncPath('Restaurants/escape.md');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('outside_vault');
	});

	it('rejects a path under a symlinked directory that escapes the vault', async () => {
		symlinkSync(outside, path.join(vault, 'Restaurants', 'escapedir'));
		const result = await paths.resolveSyncPath('Restaurants/escapedir/secrets.txt');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('outside_vault');
	});

	it('rejects a not-yet-created path under an escaping symlink', async () => {
		const result = await paths.resolveSyncPath('Restaurants/escapedir/brand-new.md');
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('outside_vault');
	});
});

describe('toSyncRelPath', () => {
	it('maps vault-internal absolute paths to wire paths', () => {
		expect(paths.toSyncRelPath(path.join(vault, 'Restaurants', 'Etta.md'))).toBe(
			'Restaurants/Etta.md'
		);
		expect(paths.toSyncRelPath(path.join(vault, 'Restaurants', '_Lists', 'Brunch.md'))).toBe(
			'Restaurants/_Lists/Brunch.md'
		);
		expect(paths.toSyncRelPath(path.join(vault, 'info.md'))).toBe('info.md');
	});

	it('returns null for paths that never belong in a manifest', () => {
		expect(paths.toSyncRelPath(path.join(vault, '.restauranteer', 'index.db'))).toBeNull();
		expect(
			paths.toSyncRelPath(path.join(vault, 'Restaurants', '.restauranteer-tmp', 'x.tmp'))
		).toBeNull();
		expect(paths.toSyncRelPath(path.join(outside, 'secrets.txt'))).toBeNull();
		expect(paths.toSyncRelPath(vault)).toBeNull();
	});
});

describe('contentTypeFor', () => {
	it('picks a type from the extension', () => {
		expect(paths.contentTypeFor('Restaurants/Etta.md')).toBe('text/markdown; charset=utf-8');
		expect(paths.contentTypeFor('.restauranteer-settings.json')).toBe(
			'application/json; charset=utf-8'
		);
		expect(paths.contentTypeFor('Restaurants/_attachments/a/b.JPG')).toBe('image/jpeg');
		expect(paths.contentTypeFor('Restaurants/_attachments/a/b.bin')).toBe(
			'application/octet-stream'
		);
	});
});

/**
 * List names become filenames under `Restaurants/_Lists/`, so an unsanitized
 * name was a write and unlink outside the vault. The string rules are tested
 * here, and — because a string check is only worth what the sink enforces —
 * so is the sink itself: `writeMocForList` must leave nothing on disk outside
 * the lists directory when handed a traversal name.
 *
 * Config snapshots VAULT_PATH at import time, so the production modules are
 * imported dynamically after the scratch vault is configured.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateListName, isSafeListName } from '../../src/lib/server/vault/listName';

describe('validateListName', () => {
	it('accepts ordinary names', () => {
		for (const name of ['Favourites', 'Date Night', 'Best of 2026', "Mum's picks", 'Ramen 🍜']) {
			expect(validateListName(name)).toEqual({ ok: true, name });
		}
	});

	it('trims before validating and returns the trimmed name', () => {
		expect(validateListName('  Favourites  ')).toEqual({ ok: true, name: 'Favourites' });
	});

	it('rejects traversal, separators and dotfiles', () => {
		const cases: [string, string][] = [
			['../../../tmp/pwned', 'separator'],
			['..', 'traversal'],
			['.', 'traversal'],
			['.hidden', 'dotfile'],
			['a/b', 'separator'],
			// Backslash is a separator on the macOS/iOS clients sharing this vault.
			['a\\b', 'separator'],
			['a\nb', 'separator'],
			['a\0b', 'nul'],
			['', 'empty'],
			['   ', 'empty'],
			['x'.repeat(61), 'too_long']
		];
		for (const [input, reason] of cases) {
			expect(validateListName(input), input).toEqual({ ok: false, reason });
		}
	});

	it('isSafeListName agrees with validateListName', () => {
		expect(isSafeListName('Favourites')).toBe(true);
		expect(isSafeListName('../escape')).toBe(false);
		expect(isSafeListName(null)).toBe(false);
	});
});

describe('MOC writing refuses to escape the lists directory', () => {
	let root: string;
	let moc: typeof import('../../src/lib/server/vault/moc');

	beforeAll(async () => {
		// realpath: /tmp is a symlink to /private/tmp on macOS, and a containment
		// check that compares unresolved paths would be meaningless.
		root = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'restauranteer-listname-'));
		mkdirSync(path.join(root, 'vault', 'Restaurants', '_Lists'), { recursive: true });
		process.env.VAULT_PATH = path.join(root, 'vault');
		moc = await import('../../src/lib/server/vault/moc');
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it('does not delete a file outside the lists directory', async () => {
		// The escape is a DELETE, not a write: an empty list takes the unlink
		// branch, and pre-fix `path.join(listsDir(), '../../../pwned.md')`
		// resolved to a real file outside the vault. Plant one and prove it
		// survives — asserting "nothing was created" would pass vacuously,
		// because the empty-list path never writes in the first place.
		const escaped = path.join(root, 'pwned.md');
		writeFileSync(escaped, 'not restauranteer’s file');
		await moc.writeMocForList('../../../pwned');
		expect(existsSync(escaped)).toBe(true);
		expect(readFileSync(escaped, 'utf8')).toBe('not restauranteer’s file');
	});

	it('still writes MOCs for ordinary names, inside the lists directory', async () => {
		await moc.createEmptyListMoc('Favourites');
		expect(existsSync(path.join(root, 'vault', 'Restaurants', '_Lists', 'Favourites.md')))
			.toBe(true);
	});

	it('skips rather than throwing, so one bad name cannot break boot', async () => {
		await expect(moc.writeMocForList('../../../pwned')).resolves.toBeUndefined();
		await expect(moc.writeMocForList('.hidden')).resolves.toBeUndefined();
	});
});

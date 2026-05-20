import { describe, expect, it } from 'vitest';
import { threeWayMerge, conflictCopyPath } from '../../src/lib/server/vault/merge';
import type { Frontmatter } from '../../src/lib/server/vault/types';

const fm = (overrides: Partial<Frontmatter>): Frontmatter => ({
	id: '01H',
	schema_version: 1,
	name: 'Cumulus Inc',
	...overrides
});

describe('threeWayMerge', () => {
	it('no changes anywhere → returns loaded unchanged', () => {
		const res = threeWayMerge({
			loaded: { frontmatter: fm({}), body: 'orig' },
			current: { frontmatter: fm({}), body: 'orig' },
			pending: { frontmatter: fm({}), body: 'orig' },
			dirtyFields: [],
			bodyDirty: false
		});
		expect(res.kind).toBe('clean');
		if (res.kind === 'clean') {
			expect(res.body).toBe('orig');
			expect(res.frontmatter.name).toBe('Cumulus Inc');
		}
	});

	it('user adds a tag, disk unchanged → pending tag wins', () => {
		const res = threeWayMerge({
			loaded: { frontmatter: fm({ tags: ['a'] }), body: 'b' },
			current: { frontmatter: fm({ tags: ['a'] }), body: 'b' },
			pending: { frontmatter: fm({ tags: ['a', 'b'] }), body: 'b' },
			dirtyFields: ['tags'],
			bodyDirty: false
		});
		expect(res.kind).toBe('clean');
		if (res.kind === 'clean') expect(res.frontmatter.tags).toEqual(['a', 'b']);
	});

	it('disk added a field user did not touch → disk field is preserved', () => {
		const res = threeWayMerge({
			loaded: { frontmatter: fm({ tags: ['a'] }), body: 'b' },
			current: { frontmatter: fm({ tags: ['a'], rating: 5 }), body: 'b' },
			pending: { frontmatter: fm({ tags: ['a', 'b'] }), body: 'b' },
			dirtyFields: ['tags'],
			bodyDirty: false
		});
		expect(res.kind).toBe('clean');
		if (res.kind === 'clean') {
			expect(res.frontmatter.rating).toBe(5);
			expect(res.frontmatter.tags).toEqual(['a', 'b']);
		}
	});

	it('user did not edit body, but disk body changed → disk body wins', () => {
		const res = threeWayMerge({
			loaded: { frontmatter: fm({}), body: 'original' },
			current: { frontmatter: fm({}), body: 'updated on disk' },
			pending: { frontmatter: fm({}), body: 'original' },
			dirtyFields: [],
			bodyDirty: false
		});
		expect(res.kind).toBe('clean');
		if (res.kind === 'clean') expect(res.body).toBe('updated on disk');
	});

	it('user edits body, disk unchanged → pending body wins', () => {
		const res = threeWayMerge({
			loaded: { frontmatter: fm({}), body: 'original' },
			current: { frontmatter: fm({}), body: 'original' },
			pending: { frontmatter: fm({}), body: 'my new visit notes' },
			dirtyFields: [],
			bodyDirty: true
		});
		expect(res.kind).toBe('clean');
		if (res.kind === 'clean') expect(res.body).toBe('my new visit notes');
	});

	it('both user and disk edited body → conflict', () => {
		const res = threeWayMerge({
			loaded: { frontmatter: fm({}), body: 'original' },
			current: { frontmatter: fm({}), body: 'obsidian edit' },
			pending: { frontmatter: fm({}), body: 'app edit' },
			dirtyFields: [],
			bodyDirty: true
		});
		expect(res.kind).toBe('conflict');
		if (res.kind === 'conflict') {
			expect(res.reason).toBe('body');
			expect(res.current.body).toBe('obsidian edit');
		}
	});

	it('user clears a field (dirty but undefined in pending) → field removed', () => {
		const res = threeWayMerge({
			loaded: { frontmatter: fm({ tags: ['a'] }), body: 'b' },
			current: { frontmatter: fm({ tags: ['a'] }), body: 'b' },
			pending: { frontmatter: fm({}), body: 'b' },
			dirtyFields: ['tags'],
			bodyDirty: false
		});
		expect(res.kind).toBe('clean');
		if (res.kind === 'clean') expect(res.frontmatter.tags).toBeUndefined();
	});

	it('disk added a field, user edits the same field → dirty wins', () => {
		const res = threeWayMerge({
			loaded: { frontmatter: fm({ tags: ['a'] }), body: 'b' },
			current: { frontmatter: fm({ tags: ['a', 'disk-added'] }), body: 'b' },
			pending: { frontmatter: fm({ tags: ['a', 'user-added'] }), body: 'b' },
			dirtyFields: ['tags'],
			bodyDirty: false
		});
		expect(res.kind).toBe('clean');
		if (res.kind === 'clean') expect(res.frontmatter.tags).toEqual(['a', 'user-added']);
	});
});

describe('conflictCopyPath', () => {
	it('inserts date stamp before .md extension', () => {
		const date = new Date('2026-05-19T10:00:00Z');
		const result = conflictCopyPath('/vault/Restaurants/Cumulus Inc.md', date);
		expect(result).toBe('/vault/Restaurants/Cumulus Inc (conflict 2026-05-19).md');
	});

	it('handles files with no extension', () => {
		const date = new Date('2026-05-19T10:00:00Z');
		expect(conflictCopyPath('/x/y/z', date)).toBe('/x/y/z (conflict 2026-05-19)');
	});
});

import { describe, expect, it } from 'vitest';
import { parseRepoRef } from '../../src/lib/server/providers/github';

describe('parseRepoRef', () => {
	it('parses owner/repo shorthand', () => {
		expect(parseRepoRef('foo/bar')).toEqual({ owner: 'foo', repo: 'bar', ref: undefined });
	});

	it('parses owner/repo@ref shorthand', () => {
		expect(parseRepoRef('foo/bar@develop')).toEqual({ owner: 'foo', repo: 'bar', ref: 'develop' });
	});

	it('parses an https github URL', () => {
		expect(parseRepoRef('https://github.com/foo/bar')).toEqual({
			owner: 'foo',
			repo: 'bar',
			ref: undefined
		});
	});

	it('parses a github URL with .git suffix', () => {
		expect(parseRepoRef('https://github.com/foo/bar.git')).toEqual({
			owner: 'foo',
			repo: 'bar',
			ref: undefined
		});
	});

	it('parses a tree URL with a branch', () => {
		expect(parseRepoRef('https://github.com/foo/bar/tree/develop')).toEqual({
			owner: 'foo',
			repo: 'bar',
			ref: 'develop'
		});
	});

	it('rejects garbage input', () => {
		expect(parseRepoRef('')).toBeNull();
		expect(parseRepoRef('not a repo')).toBeNull();
		expect(parseRepoRef('https://gitlab.com/foo/bar')).toBeNull();
	});
});

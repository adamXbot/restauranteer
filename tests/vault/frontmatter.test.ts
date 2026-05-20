import { describe, expect, it } from 'vitest';
import { parse, stringify, migrate, hashContent } from '../../src/lib/server/vault/frontmatter';

describe('frontmatter', () => {
	it('parse + stringify is round-trippable for simple frontmatter', () => {
		const original = `---
id: 01H
schema_version: 1
name: Cumulus Inc
tags:
  - a
  - b
---
body content
`;
		const { frontmatter, body } = parse(original);
		expect(frontmatter.id).toBe('01H');
		expect(frontmatter.name).toBe('Cumulus Inc');
		expect(frontmatter.tags).toEqual(['a', 'b']);
		expect(body.trim()).toBe('body content');

		const serialized = stringify(frontmatter, body);
		const reparsed = parse(serialized);
		expect(reparsed.frontmatter).toEqual(frontmatter);
		expect(reparsed.body.trim()).toBe('body content');
	});

	it('handles files with no frontmatter', () => {
		const { frontmatter, body } = parse('just body text\n');
		expect(frontmatter).toEqual({});
		expect(body.trim()).toBe('just body text');
	});

	it('migrate fills in schema_version when missing', () => {
		const migrated = migrate({ id: 'x', name: 'y' });
		expect(migrated.schema_version).toBe(1);
	});

	it('hashContent is stable', () => {
		expect(hashContent('hello')).toBe(hashContent('hello'));
		expect(hashContent('hello')).not.toBe(hashContent('world'));
	});
});

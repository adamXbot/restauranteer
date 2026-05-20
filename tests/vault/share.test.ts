import { describe, expect, it } from 'vitest';
import {
	BUNDLE_MARKER,
	buildBundle,
	buildInfoFrontmatter,
	parseBundle
} from '../../src/lib/server/vault/share';

describe('bundle format', () => {
	it('round-trips a single-file bundle', () => {
		const file = `---\nid: 01H\nname: Cumulus\n---\nbody\n`;
		const bundle = buildBundle([{ filename: 'Cumulus.md', content: file }]);
		expect(bundle).toContain(BUNDLE_MARKER);
		expect(bundle).toContain('Cumulus.md');

		const parsed = parseBundle(bundle);
		expect(parsed.files).toHaveLength(1);
		expect(parsed.files[0].filename).toBe('Cumulus.md');
		expect(parsed.files[0].frontmatter.id).toBe('01H');
		expect(parsed.files[0].frontmatter.name).toBe('Cumulus');
		expect(parsed.files[0].body.trim()).toBe('body');
		expect(parsed.info?.generated_by).toBe('restauranteer');
	});

	it('round-trips a multi-file bundle', () => {
		const files = [
			{ filename: 'A.md', content: `---\nid: a\nname: A\n---\nA-body\n` },
			{ filename: 'B.md', content: `---\nid: b\nname: B\n---\nB-body\n` }
		];
		const bundle = buildBundle(files);
		const parsed = parseBundle(bundle);
		expect(parsed.files).toHaveLength(2);
		expect(parsed.files.map((f) => f.frontmatter.id)).toEqual(['a', 'b']);
		expect(parsed.files.map((f) => f.body.trim())).toEqual(['A-body', 'B-body']);
	});

	it('parses a bare single-file markdown (no bundle marker)', () => {
		const file = `---\nid: 99\nname: Solo\n---\nsolo-body\n`;
		const parsed = parseBundle(file);
		expect(parsed.files).toHaveLength(1);
		expect(parsed.files[0].filename).toBeNull();
		expect(parsed.files[0].frontmatter.id).toBe(99);
		expect(parsed.info).toBeNull();
	});

	it('treats info.md-only content as info, not a restaurant', () => {
		const info = `---\ngenerated_by: restauranteer\nschema_version: 1\napp_version: 0.1.0\n---\n# About\n`;
		const parsed = parseBundle(info);
		expect(parsed.info?.generated_by).toBe('restauranteer');
		expect(parsed.files).toHaveLength(0);
	});

	it('emits restauranteer marker in info frontmatter', () => {
		const fm = buildInfoFrontmatter();
		expect(fm.generated_by).toBe('restauranteer');
		expect(typeof fm.app_version).toBe('string');
		expect(fm.schema_version).toBe(1);
	});
});

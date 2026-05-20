import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import { CURRENT_SCHEMA_VERSION, type Frontmatter } from './types';

function normalizeDates(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(normalizeDates);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = normalizeDates(v);
		}
		return out;
	}
	return value;
}

export function parse(content: string): { frontmatter: Frontmatter; body: string } {
	const parsed = matter(content);
	const frontmatter = (normalizeDates(parsed.data ?? {}) ?? {}) as Frontmatter;
	return { frontmatter, body: parsed.content };
}

export function stringify(frontmatter: Frontmatter, body: string): string {
	const clean: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(frontmatter)) {
		if (v === undefined) continue;
		clean[k] = v;
	}
	return matter.stringify(body, clean);
}

export function migrate(fm: Frontmatter): Frontmatter {
	const migrated: Frontmatter = { ...fm };
	const v = typeof migrated.schema_version === 'number' ? migrated.schema_version : 0;
	if (v < 1) {
		migrated.schema_version = 1;
	}
	if (migrated.schema_version !== CURRENT_SCHEMA_VERSION) {
		migrated.schema_version = CURRENT_SCHEMA_VERSION;
	}
	return migrated;
}

export function hashContent(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

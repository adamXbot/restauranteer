import { stat } from 'node:fs/promises';
import path from 'node:path';
import { restaurantsDir } from '../config';

const INVALID = /[\\/:*?"<>|]/g;

export function sanitizeFilename(name: string): string {
	const cleaned = name.replace(INVALID, '').replace(/\s+/g, ' ').trim();
	return cleaned.length > 0 ? cleaned : 'Restaurant';
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

export async function resolveCollisionFreePath(
	name: string,
	suburb: string | null | undefined
): Promise<string> {
	const base = sanitizeFilename(name);
	const dir = restaurantsDir();
	const first = path.join(dir, `${base}.md`);
	if (!(await fileExists(first))) return first;

	if (suburb) {
		const suburbName = sanitizeFilename(suburb);
		const withSuburb = path.join(dir, `${base} (${suburbName}).md`);
		if (!(await fileExists(withSuburb))) return withSuburb;
	}

	for (let i = 2; i < 100; i++) {
		const candidate = path.join(dir, `${base} (${i}).md`);
		if (!(await fileExists(candidate))) return candidate;
	}
	throw new Error(`Could not resolve filename for "${name}" after 100 attempts`);
}

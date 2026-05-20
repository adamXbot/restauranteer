import { readFile, stat } from 'node:fs/promises';
import { parse, migrate, hashContent } from './frontmatter';
import type { RestaurantFile } from './types';

export async function readRestaurant(filePath: string): Promise<RestaurantFile> {
	const buf = await readFile(filePath);
	const rawContent = buf.toString('utf8');
	const { frontmatter, body } = parse(rawContent);
	const migrated = migrate(frontmatter);
	const stats = await stat(filePath);
	return {
		frontmatter: migrated,
		body,
		rawContent,
		filePath,
		mtime: stats.mtimeMs,
		sha256: hashContent(rawContent)
	};
}

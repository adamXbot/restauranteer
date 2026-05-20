import { writeMarkdownFile } from './writer';
import { upsertRestaurant } from '../db/queries';
import { writeMocForList } from './moc';
import type { Frontmatter } from './types';

/**
 * Write a restaurant file and immediately update the SQLite index.
 *
 * This is the canonical mutation path. The watcher's echo suppression will
 * drop the resulting filesystem event, so the index would never get updated
 * unless we do it explicitly here.
 *
 * If `affectedLists` is provided, the corresponding MOC files are regenerated.
 */
export async function saveRestaurant(
	filePath: string,
	frontmatter: Frontmatter,
	body: string,
	options: { affectedLists?: string[] } = {}
): Promise<{ sha: string; mtime: number }> {
	const { sha, mtime, content } = await writeMarkdownFile(filePath, frontmatter, body);
	upsertRestaurant({
		frontmatter,
		body,
		rawContent: content,
		filePath,
		mtime,
		sha256: sha
	});
	for (const list of options.affectedLists ?? []) {
		await writeMocForList(list);
	}
	return { sha, mtime };
}

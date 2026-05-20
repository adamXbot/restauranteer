import type { Frontmatter } from './types';

export type MergeInput = {
	loaded: { frontmatter: Frontmatter; body: string };
	current: { frontmatter: Frontmatter; body: string };
	pending: { frontmatter: Frontmatter; body: string };
	dirtyFields: string[];
	bodyDirty: boolean;
};

export type MergeResult =
	| { kind: 'clean'; frontmatter: Frontmatter; body: string }
	| { kind: 'conflict'; reason: 'body'; current: { frontmatter: Frontmatter; body: string } };

export function threeWayMerge(input: MergeInput): MergeResult {
	const { loaded, current, pending, dirtyFields, bodyDirty } = input;
	const dirtySet = new Set(dirtyFields);

	const diskBodyChanged = current.body !== loaded.body;
	let body: string;
	if (bodyDirty && diskBodyChanged) {
		return { kind: 'conflict', reason: 'body', current };
	} else if (bodyDirty) {
		body = pending.body;
	} else if (diskBodyChanged) {
		body = current.body;
	} else {
		body = loaded.body;
	}

	const merged: Frontmatter = {};
	const allKeys = new Set<string>([
		...Object.keys(loaded.frontmatter),
		...Object.keys(current.frontmatter),
		...Object.keys(pending.frontmatter)
	]);

	for (const key of allKeys) {
		if (dirtySet.has(key)) {
			if (key in pending.frontmatter) merged[key] = pending.frontmatter[key];
		} else if (key in current.frontmatter) {
			merged[key] = current.frontmatter[key];
		}
	}

	return { kind: 'clean', frontmatter: merged, body };
}

export function conflictCopyPath(filePath: string, now: Date = new Date()): string {
	const ext = filePath.endsWith('.md') ? '.md' : '';
	const base = ext ? filePath.slice(0, -ext.length) : filePath;
	const stamp = now.toISOString().slice(0, 10);
	return `${base} (conflict ${stamp})${ext}`;
}

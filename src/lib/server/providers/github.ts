/**
 * Public GitHub-repo discovery — pulls restaurant `.md` files out of any repo
 * that follows the restauranteer vault layout (`Restaurants/*.md`,
 * `data/Restaurants/*.md`, or just `*.md` at the root). No clone, no disk —
 * everything goes through `api.github.com` and the raw CDN.
 *
 * We deliberately accept *only public* repos here. Private syncing belongs to
 * a different code path (token storage, auth flow) and is out of scope.
 */

const API_ROOT = 'https://api.github.com';

const COMMON_DIRS = [
	'Restaurants',
	'data/Restaurants',
	'vault/Restaurants',
	'restaurants',
	''
] as const;

export type RepoRef = {
	owner: string;
	repo: string;
	ref?: string;
};

export type RemoteFile = {
	path: string;
	name: string;
	download_url: string;
	sha: string;
	size: number;
};

export type RemoteDiscoverResult = {
	repo: RepoRef;
	resolvedRef: string;
	subdir: string;
	files: RemoteFile[];
	info: string | null;
	infoPath: string | null;
	hasAttachmentsDir: boolean;
	apiRateLimit: {
		limit: number | null;
		remaining: number | null;
		reset: number | null;
	};
};

const GITHUB_URL_PATTERNS = [
	/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/?#]+))?(?:[/?#]|$)/i,
	/^([\w.-]+)\/([\w.-]+?)(?:@([\w./-]+))?$/
];

export function parseRepoRef(input: string): RepoRef | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	for (const re of GITHUB_URL_PATTERNS) {
		const m = trimmed.match(re);
		if (m) {
			const [, owner, repo, ref] = m;
			return { owner, repo: repo.replace(/\.git$/i, ''), ref: ref || undefined };
		}
	}
	return null;
}

type GhContentEntry = {
	name: string;
	path: string;
	type: 'file' | 'dir' | 'symlink' | 'submodule';
	sha: string;
	size: number;
	download_url: string | null;
};

async function ghFetch(url: string, init: RequestInit = {}): Promise<Response> {
	const token = process.env.GITHUB_TOKEN?.trim();
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'restauranteer',
		'X-GitHub-Api-Version': '2022-11-28',
		...(init.headers as Record<string, string> | undefined)
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	return fetch(url, { ...init, headers });
}

async function resolveDefaultBranch(ref: RepoRef): Promise<string> {
	const res = await ghFetch(`${API_ROOT}/repos/${ref.owner}/${ref.repo}`);
	if (!res.ok) {
		throw new Error(`GitHub repo lookup failed (${res.status} ${res.statusText})`);
	}
	const meta = (await res.json()) as { default_branch?: string };
	return meta.default_branch ?? 'main';
}

async function listDir(
	ref: RepoRef,
	subdir: string,
	resolvedRef: string
): Promise<GhContentEntry[] | null> {
	const url = `${API_ROOT}/repos/${ref.owner}/${ref.repo}/contents/${encodeSubdir(subdir)}?ref=${encodeURIComponent(resolvedRef)}`;
	const res = await ghFetch(url);
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new Error(`GitHub list failed for ${subdir || '/'}: ${res.status}`);
	}
	const data = (await res.json()) as GhContentEntry[] | GhContentEntry;
	return Array.isArray(data) ? data : [data];
}

function encodeSubdir(subdir: string): string {
	return subdir
		.split('/')
		.filter((p) => p.length > 0)
		.map((p) => encodeURIComponent(p))
		.join('/');
}

async function findInfoMarkdown(
	ref: RepoRef,
	resolvedRef: string
): Promise<{ path: string; content: string } | null> {
	for (const candidate of ['info.md', 'data/info.md', 'vault/info.md']) {
		const url = `${API_ROOT}/repos/${ref.owner}/${ref.repo}/contents/${encodeSubdir(candidate)}?ref=${encodeURIComponent(resolvedRef)}`;
		const res = await ghFetch(url);
		if (!res.ok) continue;
		const entry = (await res.json()) as GhContentEntry;
		if (entry.type !== 'file' || !entry.download_url) continue;
		const raw = await fetch(entry.download_url);
		if (!raw.ok) continue;
		return { path: entry.path, content: await raw.text() };
	}
	return null;
}

function rateLimitHeaders(res: Response): RemoteDiscoverResult['apiRateLimit'] {
	const toNum = (h: string | null): number | null => (h ? parseInt(h, 10) || null : null);
	return {
		limit: toNum(res.headers.get('x-ratelimit-limit')),
		remaining: toNum(res.headers.get('x-ratelimit-remaining')),
		reset: toNum(res.headers.get('x-ratelimit-reset'))
	};
}

export async function discoverRepo(input: RepoRef): Promise<RemoteDiscoverResult> {
	const resolvedRef = input.ref ?? (await resolveDefaultBranch(input));

	let chosenSubdir = '';
	let entries: GhContentEntry[] = [];
	for (const subdir of COMMON_DIRS) {
		const listed = await listDir(input, subdir, resolvedRef);
		if (listed && listed.some((e) => e.type === 'file' && /\.md$/i.test(e.name))) {
			chosenSubdir = subdir;
			entries = listed;
			break;
		}
	}

	if (entries.length === 0) {
		throw new Error(
			"No `Restaurants/*.md` or top-level `*.md` files found in that repo. Make sure the data layout matches restauranteer's vault."
		);
	}

	const files = entries
		.filter(
			(e) =>
				e.type === 'file' &&
				/\.md$/i.test(e.name) &&
				!/^_Lists/i.test(e.name) &&
				e.name.toLowerCase() !== 'readme.md' &&
				e.name.toLowerCase() !== 'info.md' &&
				e.download_url
		)
		.map((e) => ({
			path: e.path,
			name: e.name,
			download_url: e.download_url as string,
			sha: e.sha,
			size: e.size
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	const info = await findInfoMarkdown(input, resolvedRef);
	const attachmentsPeek = await ghFetch(
		`${API_ROOT}/repos/${input.owner}/${input.repo}/contents/${encodeSubdir(joinPath(chosenSubdir, '_attachments'))}?ref=${encodeURIComponent(resolvedRef)}`
	);

	return {
		repo: input,
		resolvedRef,
		subdir: chosenSubdir,
		files,
		info: info?.content ?? null,
		infoPath: info?.path ?? null,
		hasAttachmentsDir: attachmentsPeek.ok,
		apiRateLimit: rateLimitHeaders(attachmentsPeek)
	};
}

function joinPath(a: string, b: string): string {
	if (!a) return b;
	if (!b) return a;
	return `${a.replace(/\/$/, '')}/${b.replace(/^\//, '')}`;
}

export async function fetchRemoteFiles(
	files: Array<{ download_url: string; path: string }>
): Promise<Array<{ path: string; content: string }>> {
	const results: Array<{ path: string; content: string }> = [];
	for (const f of files) {
		const res = await fetch(f.download_url);
		if (!res.ok) {
			throw new Error(`Failed to download ${f.path} (${res.status})`);
		}
		results.push({ path: f.path, content: await res.text() });
	}
	return results;
}

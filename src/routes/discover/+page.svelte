<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import MergePicker from '$lib/components/MergePicker.svelte';
	import BundleImportResults from '$lib/components/BundleImportResults.svelte';
	import GoogleListPreview from '$lib/components/GoogleListPreview.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import DisclosureSection from '$lib/components/DisclosureSection.svelte';
	import DiscoverMapPreview from '$lib/components/DiscoverMapPreview.svelte';

	type Listing = {
		source: string;
		url: string;
		title: string;
		excerpt: string | null;
		image_url: string | null;
		suburb: string | null;
		vault_uuid: string | null;
	};

	type Candidate = {
		uuid: string;
		name: string;
		suburb: string | null;
		address: string | null;
		score: number;
		distance_m: number | null;
		reason: 'exact_name' | 'name_subset' | 'token_overlap';
	};

	type Preview = {
		name: string;
		address: string | null;
		lat: number | null;
		lng: number | null;
	};

	type BundleOutcome =
		| {
				status: 'created' | 'merged' | 'skipped';
				filename: string | null;
				name: string;
				uuid: string;
				filePath: string;
		  }
		| {
				status: 'candidates';
				filename: string | null;
				name: string;
				candidates: Candidate[];
		  }
		| { status: 'error'; filename: string | null; name: string; error: string };

	type BundleResult = {
		info: { app_version?: string; schema_version?: number } | null;
		schemaWarning: string | null;
		files: BundleOutcome[];
	};

	type GhFilePreview = {
		path: string;
		filename: string;
		name: string;
		suburb: string | null;
		cuisine: string[];
		hasFrontmatterId: boolean;
		matchUuid: string | null;
	};

	type GhDiscoverResponse = {
		repo: { owner: string; repo: string };
		ref: string;
		subdir: string;
		info: Record<string, unknown> | null;
		compatible: boolean;
		hasAttachmentsDir: boolean;
		files: GhFilePreview[];
		ourSchemaVersion: number;
	};

	const SOURCE_LABEL: Record<string, string> = {
		broadsheet: 'Broadsheet',
		goodfood: 'Good Food',
		agfg: 'AGFG',
		applemaps: 'Apple Maps',
		google: 'Google Maps',
		timeout: 'Time Out'
	};

	let { data }: { data: PageData } = $props();
	const browsableSources = $derived(
		data.sources.filter((s) => s.suburbBrowsable || s.cityBrowsable)
	);

	// svelte-ignore state_referenced_locally
	let source = $state<string>(
		data.sources.filter((s) => s.suburbBrowsable || s.cityBrowsable)[0]?.id ?? 'broadsheet'
	);
	// svelte-ignore state_referenced_locally
	let city = $state<string>(
		data.sources.filter((s) => s.suburbBrowsable || s.cityBrowsable)[0]?.cities[0]?.id ??
			'melbourne'
	);
	let suburb = $state('');
	let listings = $state<Listing[]>([]);
	let loading = $state(false);
	let listError = $state<string | null>(null);
	let lastSearchedSuburb = $state<string | null>(null);
	let browseOpen = $state(false);

	type Suburb = { slug: string; label: string };
	let suburbOptions = $state<Suburb[]>([]);
	let suburbsLoading = $state(false);
	let suburbsError = $state<string | null>(null);

	let importingUrl = $state<string | null>(null);

	// Markdown paste import
	let mdText = $state('');
	let mdBusy = $state(false);
	let mdError = $state<string | null>(null);
	let mdResult = $state<BundleResult | null>(null);

	// GitHub repo source
	let ghRepo = $state('');
	let ghLoading = $state(false);
	let ghError = $state<string | null>(null);
	let ghDiscovery = $state<GhDiscoverResponse | null>(null);
	let ghSelected = $state<Set<string>>(new Set());
	let ghImporting = $state(false);
	let ghImportResult = $state<BundleResult | null>(null);
	let ghImportRepo = $state<{ repo: string; ref: string } | null>(null);

	type MergeContext = {
		url: string;
		source: string;
		candidates: Candidate[];
		preview: Preview;
	};
	let mergeContext = $state<MergeContext | null>(null);

	type ListPreviewContext = {
		name: string;
		notes: string | null;
		icon: string | null;
		source_url: string | null;
		place_ids: string[];
	};
	let listPreviewContext = $state<ListPreviewContext | null>(null);
	let listImportMsg = $state<string | null>(null);

	const currentSource = $derived(browsableSources.find((s) => s.id === source));
	const cities = $derived(currentSource?.cities ?? []);
	const sourceUsesSuburb = $derived(currentSource?.suburbBrowsable === true);

	$effect(() => {
		// reset city when source changes
		const s = browsableSources.find((x) => x.id === source);
		if (s && !s.cities.some((c) => c.id === city)) {
			city = s.cities[0]?.id ?? '';
		}
	});

	$effect(() => {
		// (re)load the suburb list only for sources that filter by suburb
		if (!source || !city) return;
		if (!sourceUsesSuburb) {
			suburbOptions = [];
			suburbsError = null;
			return;
		}
		void loadSuburbOptions(false);
	});

	async function loadSuburbOptions(refresh: boolean) {
		const src = source;
		const c = city;
		if (!src || !c) return;
		suburbsLoading = true;
		suburbsError = null;
		try {
			const params = new URLSearchParams({ city: c });
			if (refresh) params.set('refresh', '1');
			const res = await fetch(`/api/sources/${src}/suburbs?${params.toString()}`);
			if (!res.ok) {
				suburbsError = `Suburb list unavailable (${res.status})`;
				suburbOptions = [];
				return;
			}
			const data = (await res.json()) as { suburbs: Suburb[] };
			// Ignore stale responses if the user has moved on
			if (src === source && c === city) {
				suburbOptions = data.suburbs;
			}
		} catch (e) {
			suburbsError = String(e instanceof Error ? e.message : e);
			suburbOptions = [];
		} finally {
			suburbsLoading = false;
		}
	}

	async function loadSuburb(refresh = false) {
		const trimmed = suburb.trim();
		if (!source || !city) return;
		if (sourceUsesSuburb && !trimmed) return;
		loading = true;
		listError = null;
		listings = [];
		lastSearchedSuburb = sourceUsesSuburb ? trimmed : null;
		try {
			const params = new URLSearchParams({ city });
			if (sourceUsesSuburb) params.set('suburb', trimmed);
			if (refresh) params.set('refresh', '1');
			const res = await fetch(`/api/sources/${source}/discover?${params.toString()}`);
			if (!res.ok) {
				listError = `Failed to load (${res.status}). Sites may have changed their layout.`;
				loading = false;
				return;
			}
			const data = (await res.json()) as { listings: Listing[] };
			listings = data.listings;
		} catch (e) {
			listError = String(e);
		} finally {
			loading = false;
		}
	}

	let clearing = $state(false);
	let clearMsg = $state<string | null>(null);
	async function clearAllCache() {
		if (!confirm('Wipe every cached page from every source? Next load re-fetches everything.')) {
			return;
		}
		clearing = true;
		clearMsg = null;
		try {
			const res = await fetch('/api/cache?all=1', { method: 'DELETE' });
			if (!res.ok) {
				clearMsg = `Failed: ${res.status}`;
			} else {
				const data = (await res.json()) as { cleared: number };
				clearMsg = `Cleared ${data.cleared} entries.`;
				listings = [];
			}
		} catch (e) {
			clearMsg = String(e);
		} finally {
			clearing = false;
		}
	}

	type ImportResponse =
		| { type: 'created' | 'linked'; uuid: string; source: string }
		| {
				type: 'candidates';
				source: string;
				candidates: Candidate[];
				preview: Preview;
		  }
		| {
				type: 'list_preview';
				source: string;
				name: string;
				notes: string | null;
				icon: string | null;
				source_url: string | null;
				place_ids: string[];
		  };

	async function postImport(payload: { url: string; link_to_uuid?: string; force_new?: boolean }) {
		const res = await fetch('/api/import', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) {
			const txt = await res.text();
			throw new Error(txt || `HTTP ${res.status}`);
		}
		return (await res.json()) as ImportResponse;
	}

	async function importListing(l: Listing) {
		importingUrl = l.url;
		try {
			const result = await postImport({ url: l.url });
			if (result.type === 'candidates') {
				mergeContext = {
					url: l.url,
					source: result.source,
					candidates: result.candidates,
					preview: result.preview
				};
				importingUrl = null;
				return;
			}
			if (result.type === 'list_preview') {
				listPreviewContext = {
					name: result.name,
					notes: result.notes,
					icon: result.icon,
					source_url: result.source_url,
					place_ids: result.place_ids
				};
				importingUrl = null;
				return;
			}
			await goto(`/restaurant/${result.uuid}`);
		} catch (e) {
			listError = String(e);
			importingUrl = null;
		}
	}

	async function mergeInto(uuid: string) {
		if (!mergeContext) return;
		const ctx = mergeContext;
		try {
			const result = await postImport({ url: ctx.url, link_to_uuid: uuid });
			if (result.type !== 'created' && result.type !== 'linked') {
				listError = 'Unexpected response from merge';
				return;
			}
			mergeContext = null;
			await goto(`/restaurant/${result.uuid}`);
		} catch (e) {
			listError = String(e);
		}
	}

	async function createNewFromMerge() {
		if (!mergeContext) return;
		const ctx = mergeContext;
		try {
			const result = await postImport({ url: ctx.url, force_new: true });
			if (result.type !== 'created' && result.type !== 'linked') {
				listError = 'Unexpected response when creating new';
				return;
			}
			mergeContext = null;
			await goto(`/restaurant/${result.uuid}`);
		} catch (e) {
			listError = String(e);
		}
	}

	async function postMarkdownImport(payload: {
		markdown: string;
		force_new?: boolean;
		resolutions?: Record<string, string>;
	}): Promise<BundleResult> {
		const res = await fetch('/api/import/markdown', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
		return (await res.json()) as BundleResult;
	}

	async function runMarkdownImport() {
		const text = mdText.trim();
		if (!text) return;
		mdBusy = true;
		mdError = null;
		try {
			mdResult = await postMarkdownImport({ markdown: text });
		} catch (e) {
			mdError = String(e instanceof Error ? e.message : e);
		} finally {
			mdBusy = false;
		}
	}

	async function resolveMarkdownImport(resolutions: Record<string, string>) {
		const text = mdText.trim();
		if (!text) return;
		mdBusy = true;
		try {
			mdResult = await postMarkdownImport({ markdown: text, resolutions });
		} catch (e) {
			mdError = String(e instanceof Error ? e.message : e);
		} finally {
			mdBusy = false;
		}
	}

	async function loadGhRepo() {
		const repo = ghRepo.trim();
		if (!repo) return;
		ghLoading = true;
		ghError = null;
		ghDiscovery = null;
		ghSelected = new Set();
		try {
			const res = await fetch(`/api/sources/github/discover?repo=${encodeURIComponent(repo)}`);
			if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
			ghDiscovery = (await res.json()) as GhDiscoverResponse;
			// Default-select files that aren't already in the vault
			const next = new Set<string>();
			for (const f of ghDiscovery.files) {
				if (!f.matchUuid) next.add(f.path);
			}
			ghSelected = next;
		} catch (e) {
			ghError = String(e instanceof Error ? e.message : e);
		} finally {
			ghLoading = false;
		}
	}

	function toggleGhFile(path: string) {
		const next = new Set(ghSelected);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		ghSelected = next;
	}

	async function importFromGh(resolutions?: Record<string, string>) {
		if (!ghDiscovery) return;
		const paths = Array.from(ghSelected);
		if (paths.length === 0) return;
		ghImporting = true;
		ghError = null;
		try {
			const res = await fetch('/api/sources/github/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repo: `${ghDiscovery.repo.owner}/${ghDiscovery.repo.repo}`,
					ref: ghDiscovery.ref,
					paths,
					resolutions
				})
			});
			if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
			const data = (await res.json()) as BundleResult & { repo: { owner: string; repo: string }; ref: string };
			ghImportRepo = { repo: `${data.repo.owner}/${data.repo.repo}`, ref: data.ref };
			ghImportResult = data;
		} catch (e) {
			ghError = String(e instanceof Error ? e.message : e);
		} finally {
			ghImporting = false;
		}
	}
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href="/" />
	<h1 class="mt-2 text-2xl font-semibold text-primary">Discover</h1>
	<p class="mt-1 text-sm text-secondary">Find or import places.</p>
</header>

<section class="grid gap-2 px-5 pt-3">
	<a
		href="/near"
		class="flex items-center justify-between gap-3 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-on-accent shadow-lg shadow-accent/20"
	>
		<span class="flex items-center gap-2">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="h-5 w-5"
				aria-hidden="true"
			>
				<path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0118 0z" />
				<circle cx="12" cy="10" r="3" />
			</svg>
			Near me
		</span>
		<span class="text-xs text-on-accent/80">Map search →</span>
	</a>
	<a
		href="/inbox"
		class="flex items-center justify-between gap-3 rounded-2xl border border-line bg-panel/60 px-4 py-3 text-sm text-secondary transition-colors hover:border-line-strong hover:bg-panel"
	>
		<span class="flex items-center gap-2">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="h-5 w-5 text-accent"
				aria-hidden="true"
			>
				<path d="M3 7h18M3 12h18M3 17h18" />
			</svg>
			<span>
				<span class="block">Paste a URL</span>
				<span class="block text-[11px] text-tertiary">Import or save</span>
			</span>
		</span>
		<span class="text-xs text-tertiary">Inbox →</span>
	</a>
	{#if data.australianCentric}
		<button
			type="button"
			onclick={() => (browseOpen = !browseOpen)}
			aria-expanded={browseOpen}
			class="flex items-center justify-between gap-3 rounded-2xl border border-line bg-panel/60 px-4 py-3 text-left text-sm text-secondary transition-colors hover:border-line-strong hover:bg-panel"
		>
			<span class="flex items-center gap-2">
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="h-5 w-5 text-accent"
					aria-hidden="true"
				>
					<path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
					<path d="M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15z" />
				</svg>
				<span>
					<span class="block">Browse</span>
					<span class="block text-[11px] text-tertiary">Reviews by city</span>
				</span>
			</span>
			<span class="text-xs text-tertiary">{browseOpen ? 'Hide' : 'Open'} →</span>
		</button>
	{/if}
</section>

<DiscoverMapPreview
	mapboxToken={data.mapboxToken}
	googleMapsKey={data.googleMapsKey}
	googleEnabled={data.googleEnabled}
	appleAvailable={data.appleAvailable}
	preferences={data.preferences}
/>

{#if browseOpen && data.australianCentric}
<section class="px-5 pt-5 pb-2">
	<h2 class="text-xs tracking-widest text-tertiary uppercase">Browse publications</h2>
	{#if browsableSources.length === 0}
		<p class="mt-2 text-xs text-tertiary">No browsable sources right now.</p>
	{:else}
		<div class="mt-2 grid grid-cols-2 gap-2">
			<label class="flex flex-col gap-1">
				<span class="text-xs text-secondary">Source</span>
				<select
					bind:value={source}
					class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary"
				>
					{#each browsableSources as s (s.id)}
						<option value={s.id}>{s.label}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-xs text-secondary">City</span>
				<select
					bind:value={city}
					class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary"
				>
					{#each cities as c (c.id)}
						<option value={c.id}>{c.label}</option>
				{/each}
				</select>
			</label>
		</div>
		{#if sourceUsesSuburb}
			<label class="mt-2 flex flex-col gap-1">
				<span class="flex items-center justify-between text-xs text-secondary">
					<span>
						Suburb
						{#if suburbsLoading}
							<span class="ml-1 text-tertiary">· loading…</span>
						{:else if suburbOptions.length > 0}
							<span class="ml-1 text-tertiary">· {suburbOptions.length} known</span>
						{/if}
					</span>
					<button
						type="button"
						onclick={() => loadSuburbOptions(true)}
						disabled={suburbsLoading}
						title="Refresh the suburb list"
						class="text-[11px] text-tertiary hover:text-secondary disabled:opacity-50"
					>
						↻
					</button>
				</span>
				<input
					type="text"
					bind:value={suburb}
					list="suburb-options"
					placeholder={suburbOptions.length > 0
						? `e.g. ${suburbOptions[0].label}`
						: 'Suburb'}
					onkeydown={(e) => {
						if (e.key === 'Enter') loadSuburb(false);
					}}
					class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
					autocomplete="off"
					autocorrect="off"
					autocapitalize="words"
					spellcheck="false"
				/>
				<datalist id="suburb-options">
					{#each suburbOptions as s (s.slug)}
						<option value={s.label}></option>
					{/each}
				</datalist>
				{#if suburbsError}
					<span class="text-[11px] text-warning">{suburbsError}</span>
				{/if}
			</label>
		{:else}
			<p class="mt-2 text-[11px] text-tertiary">City-wide results</p>
		{/if}
		<div class="mt-3 flex gap-2">
			<button
				type="button"
				onclick={() => loadSuburb(false)}
				disabled={loading || !city || (sourceUsesSuburb && suburb.trim().length === 0)}
				class="flex-1 rounded-xl bg-panel-2 px-4 py-2.5 text-sm text-primary disabled:opacity-50"
			>
				{loading
					? 'Loading…'
					: sourceUsesSuburb
						? `Browse ${currentSource?.label ?? ''}`
						: `Browse ${currentSource?.label ?? ''} ${cities.find((c) => c.id === city)?.label ?? ''}`}
			</button>
			<button
				type="button"
				onclick={() => loadSuburb(true)}
				disabled={loading || !city || (sourceUsesSuburb && suburb.trim().length === 0)}
				title="Force re-fetch (bypass cache)"
				class="rounded-xl border border-line-strong bg-panel px-3 py-2.5 text-sm text-secondary disabled:opacity-50"
			>
				↻
			</button>
		</div>
		{#if listError}
			<p class="mt-2 text-xs text-danger">{listError}</p>
		{/if}
		{#if !loading && lastSearchedSuburb && listings.length === 0 && !listError}
			<p class="mt-2 text-xs text-tertiary">
				No entries in {lastSearchedSuburb}. Try another suburb.
			</p>
		{/if}
		<div class="mt-3">
			<DisclosureSection title="Cache" meta={clearMsg ?? 'Source pages'}>
				<button
					type="button"
					onclick={clearAllCache}
					disabled={clearing}
					class="rounded-xl border border-line-strong bg-panel px-3 py-2 text-xs text-secondary disabled:opacity-50"
				>
					{clearing ? 'Clearing…' : 'Clear cached pages'}
				</button>
			</DisclosureSection>
		</div>
	{/if}
</section>
{/if}

<div class="mx-5 mt-5 mb-5">
	<DisclosureSection title="Advanced import" meta="Markdown and GitHub">
		<div>
			<p class="text-xs font-medium text-secondary">Paste markdown</p>
			<p class="mt-0.5 text-[11px] text-tertiary">Restaurant files or multi-file bundles.</p>
			<textarea
				bind:value={mdText}
				placeholder="Paste markdown"
				rows="4"
				class="mt-2 w-full resize-y rounded-xl border border-line bg-panel px-3 py-2 font-mono text-xs text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
				spellcheck="false"
				autocomplete="off"
			></textarea>
			<div class="mt-2">
				<button
					type="button"
					onclick={runMarkdownImport}
					disabled={mdBusy || mdText.trim().length === 0}
					class="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
				>
					{mdBusy ? '…' : 'Import markdown'}
				</button>
			</div>
			{#if mdError}
				<p class="mt-2 text-xs text-danger">{mdError}</p>
			{/if}
		</div>

		<div class="mt-5 border-t border-line pt-4">
			<p class="text-xs font-medium text-secondary">Sync from GitHub</p>
			<p class="mt-0.5 text-[11px] text-tertiary">Public repos with Restauranteer markdown.</p>
			<div class="mt-2 flex gap-2">
			<input
				type="text"
				bind:value={ghRepo}
				placeholder="owner/repo"
				class="flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
				autocomplete="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
			/>
			<button
				type="button"
				onclick={loadGhRepo}
				disabled={ghLoading || ghRepo.trim().length === 0}
				class="rounded-xl bg-panel-2 px-4 py-2 text-sm text-primary disabled:opacity-50"
			>
				{ghLoading ? '…' : 'Load'}
			</button>
		</div>
		{#if ghError}
			<p class="mt-2 text-xs text-danger">{ghError}</p>
		{/if}
		{#if ghDiscovery}
			<div class="mt-3 rounded-xl border border-line bg-panel/40 p-3">
				<p class="text-xs text-secondary">
					<span class="font-medium text-secondary">
						{ghDiscovery.repo.owner}/{ghDiscovery.repo.repo}
					</span>
					@ {ghDiscovery.ref}
					{#if ghDiscovery.subdir}
						· <span class="font-mono">{ghDiscovery.subdir}/</span>
					{/if}
					· {ghDiscovery.files.length} file{ghDiscovery.files.length === 1 ? '' : 's'}
				</p>
				{#if ghDiscovery.info}
					<p class="mt-1 text-[11px] text-tertiary">
						Bundle reports
						app v{(ghDiscovery.info as { app_version?: string }).app_version ?? '?'}
						· schema v{(ghDiscovery.info as { schema_version?: number }).schema_version ?? '?'}
						{#if !ghDiscovery.compatible}
							<span class="text-warning">— ahead of this app (v{ghDiscovery.ourSchemaVersion})</span>
						{/if}
					</p>
				{:else}
					<p class="mt-1 text-[11px] text-warning">
						No <span class="font-mono">info.md</span> found — schema compatibility unknown.
					</p>
				{/if}
				{#if !ghDiscovery.hasAttachmentsDir}
					<p class="mt-1 text-[11px] text-tertiary">
						Photos in <span class="font-mono">_attachments/</span> are not synced — text only.
					</p>
				{/if}
				<ul class="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
					{#each ghDiscovery.files as f (f.path)}
						<li>
							<label class="flex items-start gap-2 rounded-lg border border-line bg-panel/40 p-2">
								<input
									type="checkbox"
									checked={ghSelected.has(f.path)}
									onchange={() => toggleGhFile(f.path)}
									class="mt-0.5"
								/>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm text-primary">{f.name}</p>
									<p class="truncate text-[11px] text-tertiary">
										{#if f.matchUuid}
											<a
												href={`/restaurant/${f.matchUuid}`}
												class="text-accent underline decoration-line-strong underline-offset-2"
											>
												already in vault
											</a>
											·
										{/if}
										{f.suburb ?? ''}
										{#if f.cuisine.length > 0}
											· {f.cuisine.join(', ')}
										{/if}
									</p>
								</div>
							</label>
						</li>
					{/each}
				</ul>
				<div class="mt-3 flex items-center gap-2">
					<button
						type="button"
						onclick={() => importFromGh(undefined)}
						disabled={ghImporting || ghSelected.size === 0 || !ghDiscovery.compatible}
						class="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
					>
						{ghImporting ? '…' : `Import ${ghSelected.size} file${ghSelected.size === 1 ? '' : 's'}`}
					</button>
					{#if ghDiscovery.compatible}
						<button
							type="button"
							onclick={() => {
								ghSelected = new Set(ghDiscovery!.files.map((f) => f.path));
							}}
							class="text-xs text-secondary underline decoration-line-strong underline-offset-2"
						>
							select all
						</button>
					{:else}
						<p class="text-[11px] text-warning">
							Schema mismatch — upgrade restauranteer or use the paste box at your own risk.
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</div>
	</DisclosureSection>
</div>

{#if mergeContext}
	<MergePicker
		candidates={mergeContext.candidates}
		preview={mergeContext.preview}
		sourceLabel={SOURCE_LABEL[mergeContext.source] ?? mergeContext.source}
		onPick={mergeInto}
		onCreate={createNewFromMerge}
		onClose={() => (mergeContext = null)}
	/>
{/if}

{#if listPreviewContext}
	<GoogleListPreview
		initialName={listPreviewContext.name}
		initialNotes={listPreviewContext.notes}
		initialIcon={listPreviewContext.icon}
		sourceUrl={listPreviewContext.source_url}
		placeIds={listPreviewContext.place_ids}
		onClose={() => (listPreviewContext = null)}
		onImported={(r) => {
			listImportMsg = `Imported "${r.list_name}" · ${r.created} new · ${r.linked} linked${r.errors > 0 ? ` · ${r.errors} errors` : ''}`;
			listPreviewContext = null;
			goto(`/lists/${encodeURIComponent(r.list_name)}`);
		}}
	/>
{/if}

{#if listImportMsg}
	<div
		class="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-2xl border border-success/50 bg-success/15 px-4 py-2 text-xs text-success shadow-lg"
	>
		{listImportMsg}
		<button type="button" onclick={() => (listImportMsg = null)} class="ml-2 text-success/80">
			✕
		</button>
	</div>
{/if}

{#if mdResult}
	<BundleImportResults
		title="Markdown import"
		outcomes={mdResult.files}
		schemaWarning={mdResult.schemaWarning}
		info={mdResult.info}
		busy={mdBusy}
		onResolve={resolveMarkdownImport}
		onClose={() => {
			mdResult = null;
			if (mdResult === null) {
				mdText = '';
			}
		}}
	/>
{/if}

{#if ghImportResult}
	<BundleImportResults
		title={`GitHub import · ${ghImportRepo?.repo ?? ''}`}
		outcomes={ghImportResult.files}
		schemaWarning={ghImportResult.schemaWarning}
		info={ghImportResult.info}
		busy={ghImporting}
		onResolve={(resolutions) => importFromGh(resolutions)}
		onClose={() => (ghImportResult = null)}
	/>
{/if}

{#if listings.length > 0}
	<section class="grid gap-3 px-5 pt-3 pb-10">
		{#each listings as l (l.url)}
			<article class="overflow-hidden rounded-2xl border border-line bg-panel/50">
				{#if l.image_url}
					<img
						src={l.image_url}
						alt=""
						loading="lazy"
						class="h-32 w-full object-cover"
						referrerpolicy="no-referrer"
					/>
				{/if}
				<div class="p-4">
					<h3 class="text-base font-medium text-primary">{l.title}</h3>
					{#if l.suburb}
						<p class="mt-0.5 text-xs text-tertiary">{l.suburb}</p>
					{/if}
					{#if l.excerpt}
						<p class="mt-2 line-clamp-3 text-sm text-secondary">{l.excerpt}</p>
					{/if}
					<div class="mt-3 flex items-center justify-between gap-2">
						<a
							href={l.url}
							target="_blank"
							rel="noopener noreferrer"
							class="text-xs text-tertiary underline decoration-line-strong underline-offset-2"
						>
							Read on {l.source === 'broadsheet' ? 'Broadsheet' : 'Good Food'} ↗
						</a>
						{#if l.vault_uuid}
							<a
								href={`/restaurant/${l.vault_uuid}`}
								class="rounded-lg bg-panel-3 px-3 py-1.5 text-xs text-primary"
							>
								★ In vault
							</a>
						{:else}
							<button
								type="button"
								onclick={() => importListing(l)}
								disabled={importingUrl === l.url}
								class="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50"
							>
								{importingUrl === l.url ? '…' : '+ Add'}
							</button>
						{/if}
					</div>
				</div>
			</article>
		{/each}
	</section>
{/if}

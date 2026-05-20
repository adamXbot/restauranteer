<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { dev } from '$app/environment';
	import type { PageData } from './$types';
	import BackLink from '$lib/components/BackLink.svelte';
	import {
		measureCaches,
		deleteCache,
		deleteAllCaches,
		formatBytes,
		prettyCacheName,
		type CacheStats
	} from '$lib/swCache';

	let { data }: { data: PageData } = $props();

	let busyClear = $state<string | null>(null);
	let busyReconcile = $state(false);
	let busyPref = $state(false);
	let lastMsg = $state<string | null>(null);

	let offlineStats = $state<CacheStats>({
		caches: [],
		totalEntries: 0,
		totalBytes: 0,
		supported: true
	});
	let offlineLoading = $state(false);
	let busyOffline = $state<string | null>(null);

	let busyPrewarm = $state(false);
	let prewarmProgress = $state<{ done: number; total: number; label: string } | null>(null);
	let prewarmPhotos = $state(true);

	async function refreshOffline() {
		offlineLoading = true;
		try {
			offlineStats = await measureCaches();
		} finally {
			offlineLoading = false;
		}
	}

	async function clearOfflineCache(name: string) {
		if (!confirm(`Clear "${prettyCacheName(name)}" from this device?`)) return;
		busyOffline = name;
		try {
			await deleteCache(name);
			lastMsg = `Cleared ${prettyCacheName(name)}`;
			await refreshOffline();
		} catch (e) {
			lastMsg = String(e);
		} finally {
			busyOffline = null;
		}
	}

	async function clearAllOffline() {
		if (!confirm('Clear every offline cache on this device? Pages will re-fetch from the server next time.')) return;
		busyOffline = 'all';
		try {
			const n = await deleteAllCaches();
			lastMsg = `Cleared ${n} offline cache${n === 1 ? '' : 's'}`;
			await refreshOffline();
		} catch (e) {
			lastMsg = String(e);
		} finally {
			busyOffline = null;
		}
	}

	async function prewarmForOffline() {
		busyPrewarm = true;
		prewarmProgress = { done: 0, total: 0, label: 'Listing items…' };
		try {
			const targetsRes = await fetch(
				`/api/admin/prewarm-targets?photos=${prewarmPhotos ? '1' : '0'}`
			);
			if (!targetsRes.ok) throw new Error(`Failed to list: ${targetsRes.status}`);
			const targets = (await targetsRes.json()) as {
				pageData: string[];
				attachments: string[];
				photos: string[];
			};
			const urls = [...targets.pageData, ...targets.attachments, ...targets.photos];
			if (urls.length === 0) {
				lastMsg = 'Nothing to pre-warm yet.';
				return;
			}

			let cursor = 0;
			let done = 0;
			let failed = 0;
			prewarmProgress = { done: 0, total: urls.length, label: 'Pre-fetching…' };
			const CONCURRENCY = 4;
			async function worker() {
				while (true) {
					const idx = cursor++;
					if (idx >= urls.length) return;
					try {
						const r = await fetch(urls[idx], { credentials: 'same-origin' });
						if (!r.ok) failed++;
					} catch {
						failed++;
					}
					done++;
					prewarmProgress = { done, total: urls.length, label: 'Pre-fetching…' };
				}
			}
			await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

			lastMsg =
				failed === 0
					? `Pre-warmed ${urls.length} items for offline`
					: `Pre-warmed ${urls.length - failed} / ${urls.length} items (${failed} failed)`;
			await refreshOffline();
		} catch (e) {
			lastMsg = String(e);
		} finally {
			busyPrewarm = false;
			prewarmProgress = null;
		}
	}

	onMount(() => {
		void refreshOffline();
	});

	async function setPreference(key: string, value: unknown) {
		busyPref = true;
		try {
			const res = await fetch('/api/settings/preferences', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ [key]: value })
			});
			if (!res.ok) lastMsg = `Failed: ${res.status}`;
			else {
				lastMsg = 'Preferences saved';
				await invalidateAll();
			}
		} catch (e) {
			lastMsg = String(e);
		} finally {
			busyPref = false;
		}
	}

	async function clearProvider(provider: string) {
		if (!confirm(`Clear all cached entries for ${provider || 'this provider'}?`)) return;
		busyClear = provider;
		try {
			const res = await fetch(`/api/cache?provider=${encodeURIComponent(provider)}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				lastMsg = `Failed: ${res.status}`;
			} else {
				const d = (await res.json()) as { cleared: number };
				lastMsg = `Cleared ${d.cleared} entries from ${provider}`;
				await invalidateAll();
			}
		} catch (e) {
			lastMsg = String(e);
		} finally {
			busyClear = null;
		}
	}

	async function clearAll() {
		if (!confirm('Wipe every cached page from every source? Next load re-fetches everything.')) return;
		busyClear = 'all';
		try {
			const res = await fetch('/api/cache?all=1', { method: 'DELETE' });
			if (!res.ok) {
				lastMsg = `Failed: ${res.status}`;
			} else {
				const d = (await res.json()) as { cleared: number };
				lastMsg = `Cleared ${d.cleared} entries`;
				await invalidateAll();
			}
		} catch (e) {
			lastMsg = String(e);
		} finally {
			busyClear = null;
		}
	}

	async function runReconcile() {
		busyReconcile = true;
		try {
			const res = await fetch('/api/admin/reconcile', { method: 'POST' });
			if (!res.ok) {
				lastMsg = `Reconcile failed: ${res.status}`;
			} else {
				const r = (await res.json()) as {
					added: number;
					updated: number;
					removed: number;
					skipped: number;
					errors: number;
				};
				lastMsg = `Reconcile: +${r.added} ~${r.updated} -${r.removed} skipped ${r.skipped} errors ${r.errors}`;
				await invalidateAll();
			}
		} catch (e) {
			lastMsg = String(e);
		} finally {
			busyReconcile = false;
		}
	}

	function relativeTime(iso: string | null): string {
		if (!iso) return 'never';
		const ms = Date.now() - new Date(iso).getTime();
		const min = Math.round(ms / 60000);
		if (min < 1) return 'just now';
		if (min < 60) return `${min}m ago`;
		const hr = Math.round(min / 60);
		if (hr < 24) return `${hr}h ago`;
		return `${Math.round(hr / 24)}d ago`;
	}
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href="/" />
	<h1 class="mt-2 text-2xl font-semibold text-slate-50">Settings</h1>
</header>

{#if lastMsg}
	<div class="mx-5 mt-2 rounded-xl border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
		{lastMsg}
	</div>
{/if}

{#if data.dirtyShutdown}
	<div class="mx-5 mt-2 rounded-xl border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
		Last reconcile didn't finish cleanly. Running another reconcile recommended.
	</div>
{/if}

<section class="mt-3 px-5">
	<h2 class="text-xs tracking-widest text-slate-500 uppercase">Vault</h2>
	<dl class="mt-2 space-y-1 text-sm">
		<div class="flex justify-between gap-2">
			<dt class="text-slate-500">Path</dt>
			<dd class="font-mono break-all text-slate-200">{data.vault.path}</dd>
		</div>
		<div class="flex justify-between gap-2">
			<dt class="text-slate-500">Subdir</dt>
			<dd class="font-mono text-slate-200">{data.vault.subdir}</dd>
		</div>
		<div class="flex justify-between gap-2">
			<dt class="text-slate-500">Obsidian vault</dt>
			<dd class="text-slate-200">{data.vault.obsidianVaultName || '— not set —'}</dd>
		</div>
		<div class="flex justify-between gap-2">
			<dt class="text-slate-500">Last reconcile</dt>
			<dd class="text-slate-200">{relativeTime(data.lastReconcile)}</dd>
		</div>
	</dl>
	<button
		type="button"
		onclick={runReconcile}
		disabled={busyReconcile}
		class="mt-3 w-full rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-sm text-slate-100 disabled:opacity-50"
	>
		{busyReconcile ? 'Reconciling…' : 'Run reconcile now'}
	</button>
</section>

<section class="mt-6 px-5">
	<h2 class="text-xs tracking-widest text-slate-500 uppercase">Preferences</h2>
	<button
		type="button"
		onclick={() => setPreference('show_review_summary', !data.preferences.show_review_summary)}
		disabled={busyPref}
		class="mt-2 flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left disabled:opacity-50"
	>
		<div>
			<p class="text-sm text-slate-100">Highlight my reviews</p>
			<p class="mt-0.5 text-[11px] text-slate-500">
				Shows your latest visit rating + a thumb on the vault list, and a tap-to-cycle
				latest/earliest/avg toggle on each restaurant page.
			</p>
		</div>
		<span
			class="rounded-full px-2.5 py-1 text-xs"
			class:bg-orange-600={data.preferences.show_review_summary}
			class:text-white={data.preferences.show_review_summary}
			class:bg-slate-800={!data.preferences.show_review_summary}
			class:text-slate-400={!data.preferences.show_review_summary}
		>
			{data.preferences.show_review_summary ? 'On' : 'Off'}
		</span>
	</button>

	<button
		type="button"
		onclick={() => setPreference('per_area_ratings', !data.preferences.per_area_ratings)}
		disabled={busyPref}
		class="mt-3 flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left disabled:opacity-50"
	>
		<div>
			<p class="text-sm text-slate-100">Per-area star ratings on visits</p>
			<p class="mt-0.5 text-[11px] text-slate-500">
				Off: one overall rating. On: rate Vibe / Food / Quality / Service separately and the
				visit's rating is their average.
			</p>
		</div>
		<span
			class="rounded-full px-2.5 py-1 text-xs"
			class:bg-orange-600={data.preferences.per_area_ratings}
			class:text-white={data.preferences.per_area_ratings}
			class:bg-slate-800={!data.preferences.per_area_ratings}
			class:text-slate-400={!data.preferences.per_area_ratings}
		>
			{data.preferences.per_area_ratings ? 'On' : 'Off'}
		</span>
	</button>

	<button
		type="button"
		onclick={() => setPreference('australian_centric', !data.preferences.australian_centric)}
		disabled={busyPref}
		class="mt-3 flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left disabled:opacity-50"
	>
		<div>
			<p class="text-sm text-slate-100">Australian-centric publications</p>
			<p class="mt-0.5 text-[11px] text-slate-500">
				On: shows Broadsheet, Good Food, Time Out and AGFG in Discover. Off: hides the "Browse a
				publication" section and the paste box only mentions Google Maps / Apple Maps.
			</p>
		</div>
		<span
			class="rounded-full px-2.5 py-1 text-xs"
			class:bg-orange-600={data.preferences.australian_centric}
			class:text-white={data.preferences.australian_centric}
			class:bg-slate-800={!data.preferences.australian_centric}
			class:text-slate-400={!data.preferences.australian_centric}
		>
			{data.preferences.australian_centric ? 'On' : 'Off'}
		</span>
	</button>

	<div class="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5">
		<p class="text-sm text-slate-100">Share format for visits</p>
		<p class="mt-0.5 text-[11px] text-slate-500">
			What "Share this visit" includes. Full keeps the structured fields (With / Vibe / Food /
			Quality / Service / Rating); Notes only is the free-form prose plus the restaurant name and
			date.
		</p>
		<div class="mt-2 grid grid-cols-2 gap-2">
			{#each ['full', 'notes_only'] as opt (opt)}
				<button
					type="button"
					onclick={() => setPreference('share_format', opt)}
					disabled={busyPref}
					class="rounded-lg px-2.5 py-1.5 text-xs"
					class:bg-orange-600={data.preferences.share_format === opt}
					class:text-white={data.preferences.share_format === opt}
					class:bg-slate-800={data.preferences.share_format !== opt}
					class:text-slate-300={data.preferences.share_format !== opt}
				>
					{opt === 'full' ? 'Full structured' : 'Notes only'}
				</button>
			{/each}
		</div>
	</div>

	<div class="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5">
		<p class="text-sm text-slate-100">Navigate using</p>
		<p class="mt-0.5 text-[11px] text-slate-500">
			Which app the "Navigate" button on a restaurant should open.
		</p>
		<div class="mt-2 grid grid-cols-2 gap-2">
			{#each ['apple', 'google'] as opt (opt)}
				<button
					type="button"
					onclick={() => setPreference('default_navigation_app', opt)}
					disabled={busyPref}
					class="rounded-lg px-2.5 py-1.5 text-xs"
					class:bg-orange-600={data.preferences.default_navigation_app === opt}
					class:text-white={data.preferences.default_navigation_app === opt}
					class:bg-slate-800={data.preferences.default_navigation_app !== opt}
					class:text-slate-300={data.preferences.default_navigation_app !== opt}
				>
					{opt === 'apple' ? 'Apple Maps' : 'Google Maps'}
				</button>
			{/each}
		</div>
	</div>

	<div class="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5">
		<p class="text-sm text-slate-100">Map provider</p>
		<p class="mt-0.5 text-[11px] text-slate-500">
			Which engine renders the Map and Near views. Mapbox needs <code class="font-mono">MAPBOX_PUBLIC_TOKEN</code>; Apple needs <code class="font-mono">APPLE_MAPKIT_*</code>; Google needs <code class="font-mono">GOOGLE_MAPS_PUBLIC_KEY</code>.
		</p>
		<div class="mt-2 grid grid-cols-3 gap-2">
			{#each [{ id: 'mapbox', label: 'Mapbox', avail: data.apiKeys.mapbox }, { id: 'apple', label: 'Apple', avail: data.apiKeys.apple_mapkit }, { id: 'google', label: 'Google', avail: data.apiKeys.google_maps }] as opt (opt.id)}
				<button
					type="button"
					onclick={() => setPreference('default_map_provider', opt.id)}
					disabled={busyPref || !opt.avail}
					class="rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-40"
					class:bg-orange-600={data.preferences.default_map_provider === opt.id}
					class:text-white={data.preferences.default_map_provider === opt.id}
					class:bg-slate-800={data.preferences.default_map_provider !== opt.id}
					class:text-slate-300={data.preferences.default_map_provider !== opt.id}
				>
					{opt.label}
				</button>
			{/each}
		</div>
	</div>
</section>

<section class="mt-6 px-5">
	<h2 class="text-xs tracking-widest text-slate-500 uppercase">API keys</h2>
	<p class="mt-1 text-[11px] text-slate-500">Edit <code class="font-mono">.env</code> and restart the container to change these.</p>
	<dl class="mt-2 space-y-1 text-sm">
		{#each Object.entries(data.apiKeys) as [name, set] (name)}
			<div class="flex items-center justify-between">
				<dt class="text-slate-300">{name}</dt>
				<dd class="text-xs" class:text-emerald-400={set} class:text-slate-500={!set}>
					{set ? '✓ configured' : '— not set —'}
				</dd>
			</div>
		{/each}
	</dl>
</section>

<section class="mt-6 px-5">
	<h2 class="text-xs tracking-widest text-slate-500 uppercase">Vault contents</h2>
	<dl class="mt-2 grid grid-cols-2 gap-2 text-sm">
		<div class="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2">
			<dt class="text-[10px] tracking-widest text-slate-500 uppercase">Restaurants</dt>
			<dd class="mt-0.5 text-lg font-medium text-slate-100">{data.stats.restaurants}</dd>
		</div>
		<div class="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2">
			<dt class="text-[10px] tracking-widest text-slate-500 uppercase">Lists</dt>
			<dd class="mt-0.5 text-lg font-medium text-slate-100">{data.stats.lists}</dd>
		</div>
		<div class="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2">
			<dt class="text-[10px] tracking-widest text-slate-500 uppercase">Distinct tags</dt>
			<dd class="mt-0.5 text-lg font-medium text-slate-100">{data.stats.tags}</dd>
		</div>
		<div class="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2">
			<dt class="text-[10px] tracking-widest text-slate-500 uppercase">Linked articles</dt>
			<dd class="mt-0.5 text-lg font-medium text-slate-100">{data.stats.articles}</dd>
		</div>
	</dl>
</section>

<section class="mt-6 px-5">
	<h2 class="text-xs tracking-widest text-slate-500 uppercase">Vault attachments</h2>
	<p class="mt-1 text-[11px] text-slate-500">
		Visit photos you've uploaded, stored on disk. Read-only — clearing happens by editing files in the vault.
	</p>
	{#if data.attachments.total_files === 0}
		<p class="mt-2 text-xs text-slate-500">No attachments yet.</p>
	{:else}
		<dl class="mt-2 space-y-1 text-sm">
			<div class="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
				<dt class="text-slate-300">Total</dt>
				<dd class="text-slate-200">
					{data.attachments.total_files} files · {formatBytes(data.attachments.total_bytes)}
				</dd>
			</div>
			{#each data.attachments.by_restaurant as g (g.slug)}
				<div class="flex items-center justify-between gap-2">
					<dt class="min-w-0 flex-1 truncate font-mono text-xs text-slate-400" title={g.slug}>
						{g.slug}
					</dt>
					<dd class="text-xs text-slate-500">{g.files} · {formatBytes(g.bytes)}</dd>
				</div>
			{/each}
		</dl>
	{/if}
</section>

<section class="mt-6 px-5">
	<h2 class="text-xs tracking-widest text-slate-500 uppercase">Server cache</h2>
	<p class="mt-1 text-[11px] text-slate-500">
		Provider responses (Google, scraped articles) stored on the server so they aren't re-fetched.
		Cached forever by default; clear here to force re-fetch on next access.
	</p>
	<dl class="mt-2 space-y-1 text-sm">
		<div class="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
			<dt class="text-slate-300">Total</dt>
			<dd class="text-slate-200">{data.cache.total}</dd>
		</div>
		{#each data.cache.by_provider as p (p.provider)}
			<div class="flex items-center justify-between gap-2">
				<dt class="truncate font-mono text-xs text-slate-400">{p.provider}</dt>
				<div class="flex items-center gap-2">
					<dd class="text-xs text-slate-500">{p.count}</dd>
					<button
						type="button"
						onclick={() => clearProvider(p.provider)}
						disabled={busyClear === p.provider}
						class="rounded-md border border-slate-800 px-2 py-0.5 text-[11px] text-slate-300 disabled:opacity-50"
					>
						{busyClear === p.provider ? '…' : 'clear'}
					</button>
				</div>
			</div>
		{/each}
	</dl>
	<button
		type="button"
		onclick={clearAll}
		disabled={busyClear !== null || data.cache.total === 0}
		class="mt-4 w-full rounded-xl border border-red-900/60 bg-red-950/20 px-4 py-2 text-sm text-red-200 disabled:opacity-50"
	>
		{busyClear === 'all' ? 'Clearing…' : 'Clear all caches'}
	</button>
</section>

<section class="mt-6 px-5 pb-10">
	<div class="flex items-baseline justify-between gap-2">
		<h2 class="text-xs tracking-widest text-slate-500 uppercase">Offline cache</h2>
		<button
			type="button"
			onclick={refreshOffline}
			disabled={offlineLoading}
			class="text-[11px] text-slate-400 disabled:opacity-50"
		>
			{offlineLoading ? 'measuring…' : '↻ refresh'}
		</button>
	</div>
	<p class="mt-1 text-[11px] text-slate-500">
		What this device has saved for offline use (service worker). Photos last ~30 days, restaurant details ~7 days.
	</p>
	{#if dev}
		<p class="mt-2 text-[11px] text-amber-400/80">
			Heads up: the service worker only runs in production builds, so this is usually empty in <code class="font-mono">pnpm dev</code>.
		</p>
	{/if}

	{#if !offlineStats.supported && !offlineLoading}
		<p class="mt-3 text-xs text-slate-500">Cache Storage API not available in this browser.</p>
	{:else if offlineStats.caches.length === 0 && !offlineLoading}
		<p class="mt-3 text-xs text-slate-500">Nothing cached yet on this device.</p>
	{:else}
		<dl class="mt-2 space-y-1 text-sm">
			<div class="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
				<dt class="text-slate-300">Total</dt>
				<dd class="text-slate-200">
					{offlineStats.totalEntries} · {formatBytes(offlineStats.totalBytes)}
				</dd>
			</div>
			{#each offlineStats.caches as c (c.name)}
				<div class="flex items-center justify-between gap-2">
					<dt class="min-w-0 flex-1 truncate font-mono text-xs text-slate-400" title={c.name}>
						{prettyCacheName(c.name)}
					</dt>
					<div class="flex items-center gap-2">
						<dd class="text-xs text-slate-500">{c.entries} · {formatBytes(c.bytes)}</dd>
						<button
							type="button"
							onclick={() => clearOfflineCache(c.name)}
							disabled={busyOffline === c.name}
							class="rounded-md border border-slate-800 px-2 py-0.5 text-[11px] text-slate-300 disabled:opacity-50"
						>
							{busyOffline === c.name ? '…' : 'clear'}
						</button>
					</div>
				</div>
			{/each}
		</dl>
	{/if}

	<div class="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5">
		<p class="text-sm text-slate-100">Pre-download for offline</p>
		<p class="mt-0.5 text-[11px] text-slate-500">
			Fetches every saved restaurant's page + attachments {prewarmPhotos ? 'and one Google photo each' : ''} so they work without a connection.
		</p>
		<label class="mt-2 flex items-center gap-2 text-xs text-slate-300">
			<input
				type="checkbox"
				bind:checked={prewarmPhotos}
				disabled={busyPrewarm}
				class="h-3.5 w-3.5"
			/>
			Include Google photos (calls Google once per restaurant on first run)
		</label>
		{#if prewarmProgress}
			<div class="mt-2">
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
					<div
						class="h-full bg-orange-500 transition-all"
						style:width="{prewarmProgress.total > 0
							? (prewarmProgress.done / prewarmProgress.total) * 100
							: 0}%"
					></div>
				</div>
				<p class="mt-1 text-[11px] text-slate-400">
					{prewarmProgress.label} {prewarmProgress.done} / {prewarmProgress.total}
				</p>
			</div>
		{/if}
		<button
			type="button"
			onclick={prewarmForOffline}
			disabled={busyPrewarm}
			class="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-100 disabled:opacity-50"
		>
			{busyPrewarm ? 'Pre-warming…' : 'Pre-warm now'}
		</button>
	</div>

	<button
		type="button"
		onclick={clearAllOffline}
		disabled={busyOffline !== null || offlineStats.totalEntries === 0}
		class="mt-4 w-full rounded-xl border border-red-900/60 bg-red-950/20 px-4 py-2 text-sm text-red-200 disabled:opacity-50"
	>
		{busyOffline === 'all' ? 'Clearing…' : 'Clear offline cache'}
	</button>
</section>

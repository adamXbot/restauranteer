<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { dev } from '$app/environment';
	import type { PageData } from './$types';
	import BackLink from '$lib/components/BackLink.svelte';
	import DisclosureSection from '$lib/components/DisclosureSection.svelte';
	import {
		THEME_MODES,
		THEME_PRESET_IDS,
		THEME_PRESETS,
		buildThemeColors,
		normalizeHexAccent,
		type ThemeMode,
		type ThemePresetId
	} from '$lib/theme';
	import { applyTheme } from '$lib/themeRuntime';
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
	let systemDark = $state(true);
	// svelte-ignore state_referenced_locally
	let themeMode = $state<ThemeMode>(data.preferences.theme_mode);
	// svelte-ignore state_referenced_locally
	let themePreset = $state<ThemePresetId>(data.preferences.theme_preset);
	// svelte-ignore state_referenced_locally
	let themeAccent = $state<string | null>(data.preferences.theme_accent);

	const themeDraft = $derived({
		theme_mode: themeMode,
		theme_preset: themePreset,
		theme_accent: themeAccent
	});
	const previewBrightness = $derived(
		themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode
	);
	const previewColors = $derived(buildThemeColors(themeDraft, previewBrightness));

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
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const updateSystemDark = () => {
			systemDark = media.matches;
		};
		updateSystemDark();
		media.addEventListener('change', updateSystemDark);
		return () => media.removeEventListener('change', updateSystemDark);
	});

	$effect(() => {
		applyTheme(themeDraft);
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

	function chooseThemeMode(mode: ThemeMode) {
		themeMode = mode;
		void setPreference('theme_mode', mode);
	}

	function chooseThemePreset(preset: ThemePresetId) {
		themePreset = preset;
		void setPreference('theme_preset', preset);
	}

	function previewAccent(value: string) {
		themeAccent = normalizeHexAccent(value);
	}

	function saveAccent(value: string) {
		const accent = normalizeHexAccent(value);
		themeAccent = accent;
		void setPreference('theme_accent', accent);
	}

	function resetAccent() {
		themeAccent = null;
		void setPreference('theme_accent', null);
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
	<h1 class="mt-2 text-2xl font-semibold text-primary">Settings</h1>
</header>

{#if lastMsg}
	<div class="mx-5 mt-2 rounded-xl border border-success/50 bg-success/10 px-3 py-2 text-xs text-success">
		{lastMsg}
	</div>
{/if}

{#if data.dirtyShutdown}
	<div class="mx-5 mt-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
		Last reconcile didn't finish cleanly. Running another reconcile recommended.
	</div>
{/if}

<section class="mt-3 px-5">
	<h2 class="text-xs tracking-widest text-tertiary uppercase">Appearance</h2>

	<div class="mt-2 rounded-xl border border-line bg-panel/60 px-3 py-2.5">
		<p class="text-sm text-primary">Mode</p>
		<div class="mt-2 grid grid-cols-3 gap-2">
			{#each THEME_MODES as mode (mode)}
				<button
					type="button"
					onclick={() => chooseThemeMode(mode)}
					disabled={busyPref}
					class="rounded-lg px-2.5 py-1.5 text-xs capitalize disabled:opacity-50"
					class:bg-accent={themeMode === mode}
					class:text-on-accent={themeMode === mode}
					class:bg-panel-2={themeMode !== mode}
					class:text-secondary={themeMode !== mode}
				>
					{mode}
				</button>
			{/each}
		</div>
	</div>

	<div class="mt-3 rounded-xl border border-line bg-panel/60 px-3 py-2.5">
		<p class="text-sm text-primary">Theme</p>
		<div class="mt-2 grid grid-cols-5 gap-2">
			{#each THEME_PRESET_IDS as id (id)}
				{@const preset = THEME_PRESETS[id]}
				<button
					type="button"
					onclick={() => chooseThemePreset(id)}
					disabled={busyPref}
					aria-label={preset.label}
					class="flex min-w-0 flex-col items-center gap-1 rounded-lg border px-1.5 py-2 text-[10px] disabled:opacity-50"
					class:border-accent={themePreset === id}
					class:bg-accent-soft={themePreset === id}
					class:border-line={themePreset !== id}
					class:bg-panel-2={themePreset !== id}
					class:text-primary={themePreset === id}
					class:text-secondary={themePreset !== id}
				>
					<span
						class="h-6 w-6 rounded-full border border-line-strong"
						style:background={preset.accent}
					></span>
					<span class="truncate">{preset.label}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="mt-3 rounded-xl border border-line bg-panel/60 px-3 py-2.5">
		<div class="flex items-center justify-between gap-3">
			<div>
				<p class="text-sm text-primary">Accent</p>
				<p class="mt-0.5 text-[11px] text-tertiary">
					{themeAccent ? 'Custom accent' : `${THEME_PRESETS[themePreset].label} accent`}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<input
					type="color"
					value={previewColors.accent}
					oninput={(e) => previewAccent(e.currentTarget.value)}
					onchange={(e) => saveAccent(e.currentTarget.value)}
					disabled={busyPref}
					class="h-9 w-12 rounded-lg border border-line bg-panel-2 p-1 disabled:opacity-50"
					aria-label="Accent colour"
				/>
				<button
					type="button"
					onclick={resetAccent}
					disabled={busyPref || !themeAccent}
					class="rounded-lg border border-line px-3 py-2 text-xs text-secondary disabled:opacity-40"
				>
					Reset
				</button>
			</div>
		</div>

		<div class="mt-3 rounded-lg border border-line bg-panel p-3">
			<div class="flex items-start justify-between gap-3">
				<div>
					<p class="text-sm font-medium text-primary">Preview table</p>
					<p class="mt-0.5 text-xs text-tertiary">Richmond · Japanese</p>
				</div>
				<span class="text-sm text-rating">★ 4.5</span>
			</div>
			<div class="mt-3 flex flex-wrap items-center gap-2">
				<span class="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-secondary">omakase</span>
				<span class="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">saved</span>
				<button
					type="button"
					class="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent"
				>
					Open
				</button>
			</div>
		</div>
	</div>
</section>

<section class="mt-6 px-5">
	<h2 class="text-xs tracking-widest text-tertiary uppercase">Preferences</h2>
	<button
		type="button"
		onclick={() => setPreference('show_review_summary', !data.preferences.show_review_summary)}
		disabled={busyPref}
		class="mt-2 flex w-full items-center justify-between rounded-xl border border-line bg-panel/60 px-3 py-2.5 text-left disabled:opacity-50"
	>
		<div>
			<p class="text-sm text-primary">Highlight my reviews</p>
			<p class="mt-0.5 text-[11px] text-tertiary">Vault rating cards</p>
		</div>
		<span
			class="rounded-full px-2.5 py-1 text-xs"
			class:bg-accent={data.preferences.show_review_summary}
			class:text-on-accent={data.preferences.show_review_summary}
			class:bg-panel-2={!data.preferences.show_review_summary}
			class:text-secondary={!data.preferences.show_review_summary}
		>
			{data.preferences.show_review_summary ? 'On' : 'Off'}
		</span>
	</button>

	<button
		type="button"
		onclick={() => setPreference('per_area_ratings', !data.preferences.per_area_ratings)}
		disabled={busyPref}
		class="mt-3 flex w-full items-center justify-between rounded-xl border border-line bg-panel/60 px-3 py-2.5 text-left disabled:opacity-50"
	>
		<div>
			<p class="text-sm text-primary">Per-area ratings</p>
			<p class="mt-0.5 text-[11px] text-tertiary">
				{data.preferences.per_area_ratings ? 'Vibe / Food / Quality / Service' : 'One rating'}
			</p>
		</div>
		<span
			class="rounded-full px-2.5 py-1 text-xs"
			class:bg-accent={data.preferences.per_area_ratings}
			class:text-on-accent={data.preferences.per_area_ratings}
			class:bg-panel-2={!data.preferences.per_area_ratings}
			class:text-secondary={!data.preferences.per_area_ratings}
		>
			{data.preferences.per_area_ratings ? 'On' : 'Off'}
		</span>
	</button>

	<button
		type="button"
		onclick={() => setPreference('australian_centric', !data.preferences.australian_centric)}
		disabled={busyPref}
		class="mt-3 flex w-full items-center justify-between rounded-xl border border-line bg-panel/60 px-3 py-2.5 text-left disabled:opacity-50"
	>
		<div>
			<p class="text-sm text-primary">Australian publications</p>
			<p class="mt-0.5 text-[11px] text-tertiary">
				{data.preferences.australian_centric ? 'Shown in Discover' : 'Hidden from Discover'}
			</p>
		</div>
		<span
			class="rounded-full px-2.5 py-1 text-xs"
			class:bg-accent={data.preferences.australian_centric}
			class:text-on-accent={data.preferences.australian_centric}
			class:bg-panel-2={!data.preferences.australian_centric}
			class:text-secondary={!data.preferences.australian_centric}
		>
			{data.preferences.australian_centric ? 'On' : 'Off'}
		</span>
	</button>

	<div class="mt-3 rounded-xl border border-line bg-panel/60 px-3 py-2.5">
		<p class="text-sm text-primary">Share format for visits</p>
		<p class="mt-0.5 text-[11px] text-tertiary">
			{data.preferences.share_format === 'full' ? 'Structured fields' : 'Notes only'}
		</p>
		<div class="mt-2 grid grid-cols-2 gap-2">
			{#each ['full', 'notes_only'] as opt (opt)}
				<button
					type="button"
					onclick={() => setPreference('share_format', opt)}
					disabled={busyPref}
					class="rounded-lg px-2.5 py-1.5 text-xs"
					class:bg-accent={data.preferences.share_format === opt}
					class:text-on-accent={data.preferences.share_format === opt}
					class:bg-panel-2={data.preferences.share_format !== opt}
					class:text-secondary={data.preferences.share_format !== opt}
				>
					{opt === 'full' ? 'Full structured' : 'Notes only'}
				</button>
			{/each}
		</div>
	</div>

	<div class="mt-3 rounded-xl border border-line bg-panel/60 px-3 py-2.5">
		<p class="text-sm text-primary">Navigate using</p>
		<p class="mt-0.5 text-[11px] text-tertiary">
			{data.preferences.default_navigation_app === 'apple' ? 'Apple Maps' : 'Google Maps'}
		</p>
		<div class="mt-2 grid grid-cols-2 gap-2">
			{#each ['apple', 'google'] as opt (opt)}
				<button
					type="button"
					onclick={() => setPreference('default_navigation_app', opt)}
					disabled={busyPref}
					class="rounded-lg px-2.5 py-1.5 text-xs"
					class:bg-accent={data.preferences.default_navigation_app === opt}
					class:text-on-accent={data.preferences.default_navigation_app === opt}
					class:bg-panel-2={data.preferences.default_navigation_app !== opt}
					class:text-secondary={data.preferences.default_navigation_app !== opt}
				>
					{opt === 'apple' ? 'Apple Maps' : 'Google Maps'}
				</button>
			{/each}
		</div>
	</div>

	<div class="mt-3 rounded-xl border border-line bg-panel/60 px-3 py-2.5">
		<p class="text-sm text-primary">Map provider</p>
		<p class="mt-0.5 text-[11px] text-tertiary">{data.preferences.default_map_provider}</p>
		<div class="mt-2 grid grid-cols-3 gap-2">
			{#each [{ id: 'mapbox', label: 'Mapbox', avail: data.apiKeys.mapbox }, { id: 'apple', label: 'Apple', avail: data.apiKeys.apple_mapkit }, { id: 'google', label: 'Google', avail: data.apiKeys.google_maps }] as opt (opt.id)}
				<button
					type="button"
					onclick={() => setPreference('default_map_provider', opt.id)}
					disabled={busyPref || !opt.avail}
					class="rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-40"
					class:bg-accent={data.preferences.default_map_provider === opt.id}
					class:text-on-accent={data.preferences.default_map_provider === opt.id}
					class:bg-panel-2={data.preferences.default_map_provider !== opt.id}
					class:text-secondary={data.preferences.default_map_provider !== opt.id}
				>
					{opt.label}
				</button>
			{/each}
		</div>
	</div>
</section>

<section class="mt-6 space-y-3 px-5 pb-10">
	<h2 class="text-xs tracking-widest text-tertiary uppercase">Advanced</h2>

	<DisclosureSection title="Vault" meta={data.vault.subdir}>
		<dl class="space-y-1 text-sm">
			<div class="flex justify-between gap-2">
				<dt class="text-tertiary">Path</dt>
				<dd class="font-mono break-all text-secondary">{data.vault.path}</dd>
			</div>
			<div class="flex justify-between gap-2">
				<dt class="text-tertiary">Subdir</dt>
				<dd class="font-mono text-secondary">{data.vault.subdir}</dd>
			</div>
			<div class="flex justify-between gap-2">
				<dt class="text-tertiary">Obsidian</dt>
				<dd class="text-secondary">{data.vault.obsidianVaultName || 'not set'}</dd>
			</div>
			<div class="flex justify-between gap-2">
				<dt class="text-tertiary">Last reconcile</dt>
				<dd class="text-secondary">{relativeTime(data.lastReconcile)}</dd>
			</div>
		</dl>
	</DisclosureSection>

	<DisclosureSection title="Reconcile" meta={relativeTime(data.lastReconcile)}>
		<button
			type="button"
			onclick={runReconcile}
			disabled={busyReconcile}
			class="w-full rounded-xl border border-line bg-panel/60 px-4 py-2 text-sm text-primary disabled:opacity-50"
		>
			{busyReconcile ? 'Reconciling…' : 'Run reconcile now'}
		</button>
	</DisclosureSection>

	<DisclosureSection title="API keys" meta={`${Object.values(data.apiKeys).filter(Boolean).length} configured`}>
		<p class="text-[11px] text-tertiary">Edit <code class="font-mono">.env</code> and restart.</p>
		<dl class="mt-2 space-y-1 text-sm">
			{#each Object.entries(data.apiKeys) as [name, set] (name)}
				<div class="flex items-center justify-between">
					<dt class="text-secondary">{name}</dt>
					<dd class="text-xs" class:text-success={set} class:text-tertiary={!set}>
						{set ? 'configured' : 'not set'}
					</dd>
				</div>
			{/each}
		</dl>
	</DisclosureSection>

	<DisclosureSection title="Vault contents" meta={`${data.stats.restaurants} restaurants`}>
		<dl class="grid grid-cols-2 gap-2 text-sm">
			<div class="rounded-xl border border-line bg-panel/40 px-3 py-2">
				<dt class="text-[10px] tracking-widest text-tertiary uppercase">Restaurants</dt>
				<dd class="mt-0.5 text-lg font-medium text-primary">{data.stats.restaurants}</dd>
			</div>
			<div class="rounded-xl border border-line bg-panel/40 px-3 py-2">
				<dt class="text-[10px] tracking-widest text-tertiary uppercase">Lists</dt>
				<dd class="mt-0.5 text-lg font-medium text-primary">{data.stats.lists}</dd>
			</div>
			<div class="rounded-xl border border-line bg-panel/40 px-3 py-2">
				<dt class="text-[10px] tracking-widest text-tertiary uppercase">Tags</dt>
				<dd class="mt-0.5 text-lg font-medium text-primary">{data.stats.tags}</dd>
			</div>
			<div class="rounded-xl border border-line bg-panel/40 px-3 py-2">
				<dt class="text-[10px] tracking-widest text-tertiary uppercase">Sources</dt>
				<dd class="mt-0.5 text-lg font-medium text-primary">{data.stats.articles}</dd>
			</div>
		</dl>
	</DisclosureSection>

	<DisclosureSection title="Attachments" meta={`${data.attachments.total_files} files`}>
		{#if data.attachments.total_files === 0}
			<p class="text-xs text-tertiary">No attachments yet.</p>
		{:else}
			<dl class="space-y-1 text-sm">
				<div class="flex items-center justify-between gap-2 border-b border-line pb-1.5">
					<dt class="text-secondary">Total</dt>
					<dd class="text-secondary">
						{data.attachments.total_files} · {formatBytes(data.attachments.total_bytes)}
					</dd>
				</div>
				{#each data.attachments.by_restaurant as g (g.slug)}
					<div class="flex items-center justify-between gap-2">
						<dt class="min-w-0 flex-1 truncate font-mono text-xs text-secondary" title={g.slug}>
							{g.slug}
						</dt>
						<dd class="text-xs text-tertiary">{g.files} · {formatBytes(g.bytes)}</dd>
					</div>
				{/each}
			</dl>
		{/if}
	</DisclosureSection>

	<DisclosureSection title="Server cache" meta={`${data.cache.total} entries`}>
		<p class="text-[11px] text-tertiary">Provider responses cached on the server.</p>
		<dl class="mt-2 space-y-1 text-sm">
			<div class="flex items-center justify-between gap-2 border-b border-line pb-1.5">
				<dt class="text-secondary">Total</dt>
				<dd class="text-secondary">{data.cache.total}</dd>
			</div>
			{#each data.cache.by_provider as p (p.provider)}
				<div class="flex items-center justify-between gap-2">
					<dt class="truncate font-mono text-xs text-secondary">{p.provider}</dt>
					<div class="flex items-center gap-2">
						<dd class="text-xs text-tertiary">{p.count}</dd>
						<button
							type="button"
							onclick={() => clearProvider(p.provider)}
							disabled={busyClear === p.provider}
							class="rounded-md border border-line px-2 py-0.5 text-[11px] text-secondary disabled:opacity-50"
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
			class="mt-4 w-full rounded-xl border border-danger/50 bg-danger/10 px-4 py-2 text-sm text-danger disabled:opacity-50"
		>
			{busyClear === 'all' ? 'Clearing…' : 'Clear all caches'}
		</button>
	</DisclosureSection>

	<DisclosureSection title="Offline cache" meta={`${offlineStats.totalEntries} entries`}>
		<div class="flex items-center justify-between gap-2">
			<p class="text-[11px] text-tertiary">Device cache for offline use.</p>
			<button
				type="button"
				onclick={refreshOffline}
				disabled={offlineLoading}
				class="text-[11px] text-secondary disabled:opacity-50"
			>
				{offlineLoading ? 'measuring…' : '↻ refresh'}
			</button>
		</div>
		{#if dev}
			<p class="mt-2 text-[11px] text-warning/80">
				Service worker cache is usually empty in <code class="font-mono">pnpm dev</code>.
			</p>
		{/if}

		{#if !offlineStats.supported && !offlineLoading}
			<p class="mt-3 text-xs text-tertiary">Cache Storage API unavailable.</p>
		{:else if offlineStats.caches.length === 0 && !offlineLoading}
			<p class="mt-3 text-xs text-tertiary">Nothing cached on this device.</p>
		{:else}
			<dl class="mt-2 space-y-1 text-sm">
				<div class="flex items-center justify-between gap-2 border-b border-line pb-1.5">
					<dt class="text-secondary">Total</dt>
					<dd class="text-secondary">
						{offlineStats.totalEntries} · {formatBytes(offlineStats.totalBytes)}
					</dd>
				</div>
				{#each offlineStats.caches as c (c.name)}
					<div class="flex items-center justify-between gap-2">
						<dt class="min-w-0 flex-1 truncate font-mono text-xs text-secondary" title={c.name}>
							{prettyCacheName(c.name)}
						</dt>
						<div class="flex items-center gap-2">
							<dd class="text-xs text-tertiary">{c.entries} · {formatBytes(c.bytes)}</dd>
							<button
								type="button"
								onclick={() => clearOfflineCache(c.name)}
								disabled={busyOffline === c.name}
								class="rounded-md border border-line px-2 py-0.5 text-[11px] text-secondary disabled:opacity-50"
							>
								{busyOffline === c.name ? '…' : 'clear'}
							</button>
						</div>
					</div>
				{/each}
			</dl>
		{/if}

		<div class="mt-4 rounded-xl border border-line bg-panel/40 px-3 py-2.5">
			<p class="text-sm text-primary">Pre-download for offline</p>
			<label class="mt-2 flex items-center gap-2 text-xs text-secondary">
				<input
					type="checkbox"
					bind:checked={prewarmPhotos}
					disabled={busyPrewarm}
					class="h-3.5 w-3.5"
				/>
				Include Google photos
			</label>
			{#if prewarmProgress}
				<div class="mt-2">
					<div class="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
						<div
							class="h-full bg-accent transition-all"
							style:width="{prewarmProgress.total > 0
								? (prewarmProgress.done / prewarmProgress.total) * 100
								: 0}%"
						></div>
					</div>
					<p class="mt-1 text-[11px] text-secondary">
						{prewarmProgress.label} {prewarmProgress.done} / {prewarmProgress.total}
					</p>
				</div>
			{/if}
			<button
				type="button"
				onclick={prewarmForOffline}
				disabled={busyPrewarm}
				class="mt-3 w-full rounded-lg border border-line-strong bg-panel-2/60 px-3 py-1.5 text-xs text-primary disabled:opacity-50"
			>
				{busyPrewarm ? 'Pre-warming…' : 'Pre-warm now'}
			</button>
		</div>

		<button
			type="button"
			onclick={clearAllOffline}
			disabled={busyOffline !== null || offlineStats.totalEntries === 0}
			class="mt-4 w-full rounded-xl border border-danger/50 bg-danger/10 px-4 py-2 text-sm text-danger disabled:opacity-50"
		>
			{busyOffline === 'all' ? 'Clearing…' : 'Clear offline cache'}
		</button>
	</DisclosureSection>
</section>

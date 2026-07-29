<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import RestaurantCard from '$lib/components/RestaurantCard.svelte';
	import {
		sortVisits,
		activeRatingArea,
		isVisitSortMode,
		VISIT_SORT_OPTIONS,
		DEFAULT_VISIT_SORT,
		type VisitSortMode
	} from '$lib/visitSort';

	let { data }: { data: PageData } = $props();

	type View = 'vault' | 'recent' | 'visits';
	type VaultView = 'grid' | 'list';
	const VIEW_STORAGE_KEY = 'restaurantListView';
	const VISIT_SORT_STORAGE_KEY = 'visitSortMode';
	const VAULT_VIEW_STORAGE_KEY = 'restauranteer.vaultView';
	let view = $state<View>('vault');
	let visitSort = $state<VisitSortMode>(DEFAULT_VISIT_SORT);
	// Grid vs list layout for the vault/recent lists. Desktop-only; set in Settings.
	let vaultView = $state<VaultView>('grid');

	onMount(() => {
		try {
			const saved = localStorage.getItem(VIEW_STORAGE_KEY);
			if (saved === 'vault' || saved === 'recent' || saved === 'visits') view = saved;
		} catch {
			// localStorage may be blocked; fall back to the default view.
		}
		try {
			const savedSort = localStorage.getItem(VISIT_SORT_STORAGE_KEY);
			if (isVisitSortMode(savedSort)) visitSort = savedSort;
		} catch {
			// ignore
		}
		try {
			const savedVaultView = localStorage.getItem(VAULT_VIEW_STORAGE_KEY);
			if (savedVaultView === 'grid' || savedVaultView === 'list') vaultView = savedVaultView;
		} catch {
			// ignore
		}
	});

	function setView(next: View) {
		view = next;
		try {
			localStorage.setItem(VIEW_STORAGE_KEY, next);
		} catch {
			// ignore
		}
	}

	function setVisitSort(next: VisitSortMode) {
		visitSort = next;
		try {
			localStorage.setItem(VISIT_SORT_STORAGE_KEY, next);
		} catch {
			// ignore
		}
	}

	// In "recent" view, sort by most recent visit first; un-visited restaurants
	// sink to the bottom, ordered alphabetically. The server already returns the
	// list A–Z, so "vault" view is the unmodified array.
	const restaurants = $derived.by(() => {
		if (view === 'vault') return data.restaurants;
		const latestDate = (r: (typeof data.restaurants)[number]) =>
			r.visitSummary.latest?.date ?? null;
		return [...data.restaurants].sort((a, b) => {
			const da = latestDate(a);
			const db = latestDate(b);
			if (da && db) return db.localeCompare(da);
			if (da) return -1;
			if (db) return 1;
			return a.name.localeCompare(b.name);
		});
	});

	const visitedCount = $derived(
		data.restaurants.filter((r) => r.visitSummary.count > 0).length
	);

	const sortedVisits = $derived(sortVisits(data.visits, visitSort));
	const visitPlaceCount = $derived(new Set(data.visits.map((v) => v.restaurantUuid)).size);
	const activeArea = $derived(activeRatingArea(visitSort));

	type AreaKey = 'vibe' | 'food' | 'quality' | 'service';
	function areaChips(v: (typeof data.visits)[number]): { key: AreaKey; label: string; value: number }[] {
		const out: { key: AreaKey; label: string; value: number }[] = [];
		if (v.vibeRating != null) out.push({ key: 'vibe', label: 'Vibe', value: v.vibeRating });
		if (v.foodRating != null) out.push({ key: 'food', label: 'Food', value: v.foodRating });
		if (v.qualityRating != null)
			out.push({ key: 'quality', label: 'Quality', value: v.qualityRating });
		if (v.serviceRating != null)
			out.push({ key: 'service', label: 'Service', value: v.serviceRating });
		return out;
	}

	function thumbUrl(relativePath: string): string {
		const rel = relativePath.replace(/^_attachments\//, '');
		const stem = rel.replace(/\.(jpg|jpeg|png|webp)$/i, '');
		return `/api/attachments/${encodeURI(`${stem}.thumb.jpg`)}`;
	}
	function fullAttachmentUrl(relativePath: string): string {
		const rel = relativePath.replace(/^_attachments\//, '');
		return `/api/attachments/${encodeURI(rel)}`;
	}
	function shortVisitDate(iso: string): string {
		const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!match) return iso;
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		return `${months[Number(match[2]) - 1]} ${Number(match[3])} ${match[1]}`;
	}
</script>

<header class="px-5 pt-4 pb-3">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="text-xs tracking-widest text-secondary uppercase">
				{view === 'visits' ? 'All visits' : view === 'recent' ? 'Recent visits' : 'Your vault'}
			</p>
			<p class="text-sm text-tertiary">
				{#if view === 'visits'}
					{data.visits.length}
					{data.visits.length === 1 ? 'visit' : 'visits'}
					{#if visitPlaceCount > 0}
						· {visitPlaceCount} {visitPlaceCount === 1 ? 'place' : 'places'}
					{/if}
				{:else if view === 'recent'}
					{visitedCount} of {data.restaurants.length} visited
				{:else}
					{data.restaurants.length}
					{data.restaurants.length === 1 ? 'restaurant' : 'restaurants'}
				{/if}
			</p>
		</div>
		<a
			href="/map"
			class="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-panel/60 px-3 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
		>
			<svg
				viewBox="0 0 24 24"
				class="h-4 w-4"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" />
			</svg>
			Map
		</a>
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-3">
		<div class="min-w-[15rem] flex-1">
			<SearchBar allowImport placeholder="Search a name, or paste a link…" />
		</div>
		{#if data.restaurants.length > 0}
			<div class="flex shrink-0 rounded-xl border border-line bg-panel/60 p-0.5 text-xs">
				<button
					type="button"
					onclick={() => setView('vault')}
					class="rounded-[10px] px-2.5 py-1 {view === 'vault'
						? 'bg-panel-2 text-primary'
						: 'text-secondary'}"
				>
					A–Z
				</button>
				<button
					type="button"
					onclick={() => setView('recent')}
					class="rounded-[10px] px-2.5 py-1 {view === 'recent'
						? 'bg-panel-2 text-primary'
						: 'text-secondary'}"
				>
					Recent
				</button>
				<button
					type="button"
					onclick={() => setView('visits')}
					class="rounded-[10px] px-2.5 py-1 {view === 'visits'
						? 'bg-panel-2 text-primary'
						: 'text-secondary'}"
				>
					Visits
				</button>
			</div>
		{/if}
	</div>
</header>

{#if view === 'visits' && data.restaurants.length > 0}
	{#if data.visits.length > 0}
		<div class="flex items-center justify-between gap-3 px-5 pb-3">
			<label for="visit-sort" class="text-xs tracking-wide text-tertiary uppercase">Sort</label>
			<select
				id="visit-sort"
				value={visitSort}
				onchange={(e) => setVisitSort(e.currentTarget.value as VisitSortMode)}
				class="min-w-0 flex-1 max-w-[15rem] rounded-xl border border-line bg-panel-2 px-3 py-1.5 text-sm text-primary outline-none"
			>
				{#each VISIT_SORT_OPTIONS as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>
		<section class="grid gap-3 px-5 pb-10">
			{#each sortedVisits as v (`${v.restaurantUuid}-${v.index}`)}
				<a
					href={`/restaurant/${v.restaurantUuid}`}
					class="block min-w-0 rounded-2xl border border-line bg-panel/50 p-4"
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 flex-1">
							<h2 class="truncate text-base font-medium text-primary">{v.restaurantName}</h2>
							<p class="mt-0.5 truncate text-xs text-secondary">
								{shortVisitDate(v.date)}{#if v.meal} · {v.meal}{/if}{#if v.suburb} · {v.suburb}{/if}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							{#if v.overallRating != null}
								<span
									class="text-sm text-rating {activeArea === 'overall' ? 'font-semibold' : ''}"
									>★ {v.overallRating}</span
								>
							{/if}
							{#if v.photo}
								<img
									src={thumbUrl(v.photo)}
									alt=""
									loading="lazy"
									class="h-10 w-10 rounded-lg bg-panel-2 object-cover"
									onerror={(e) => {
										const t = e.currentTarget as HTMLImageElement;
										const full = fullAttachmentUrl(v.photo!);
										if (t.src !== full) t.src = full;
									}}
								/>
							{/if}
						</div>
					</div>
					{#if areaChips(v).length > 0}
						<div class="mt-2 flex flex-wrap gap-1">
							{#each areaChips(v) as chip (chip.key)}
								<span
									class="rounded-full px-2 py-0.5 text-xs text-secondary {activeArea === chip.key
										? 'bg-rating/20 text-primary'
										: 'bg-panel-2'}"
								>
									{chip.label} ★{chip.value}
								</span>
							{/each}
						</div>
					{/if}
					{#if v.notesExcerpt}
						<p class="mt-2 line-clamp-2 text-xs text-secondary">{v.notesExcerpt}</p>
					{/if}
				</a>
			{/each}
		</section>
	{:else}
		<section class="px-5 pb-10">
			<div class="rounded-2xl border border-dashed border-line-strong bg-panel/30 p-6">
				<h2 class="text-base font-medium text-primary">No visits logged yet</h2>
				<p class="mt-2 text-sm text-secondary">
					Open a restaurant and tap “Start visit” to record one. They’ll all show up here.
				</p>
			</div>
		</section>
	{/if}
{:else if data.restaurants.length === 0}
	<section class="px-5 pb-10">
		<div class="rounded-2xl border border-dashed border-line-strong bg-panel/30 p-6">
			<h2 class="text-base font-medium text-primary">Nothing saved yet</h2>
			<p class="mt-2 text-sm text-secondary">Search or paste a URL to add a restaurant.</p>
			<a
				href="/discover"
				class="mt-4 inline-flex rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
			>
				Discover
			</a>
		</div>
	</section>
{:else}
	<section class="px-5 pb-10">
		<div
			class={vaultView === 'list'
				? 'flex flex-col gap-3 lg:gap-2'
				: 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'}
		>
			{#each restaurants as r (r.uuid)}
				{@const showUser = data.preferences.show_review_summary && r.visitSummary.count > 0}
				{@const userRating = showUser ? (r.visitSummary.latest?.rating ?? null) : null}
				{@const userPhoto = showUser ? (r.visitSummary.latest?.photo ?? null) : null}
				<RestaurantCard
					href={`/restaurant/${r.uuid}`}
					name={r.name}
					subtitle={r.suburb ?? r.address}
					rating={userRating ?? r.rating}
					photoThumb={userPhoto ? thumbUrl(userPhoto) : null}
					photoFull={userPhoto ? fullAttachmentUrl(userPhoto) : null}
					cuisine={r.cuisine}
					tags={r.tags}
					lists={r.lists}
					highlight={showUser}
					view={vaultView}
					footer={view === 'recent'
						? r.visitSummary.latest
							? `Visited ${shortVisitDate(r.visitSummary.latest.date)}${
									r.visitSummary.count > 1 ? ` · ${r.visitSummary.count} visits` : ''
								}`
							: 'Not visited yet'
						: null}
				/>
			{/each}
		</div>
	</section>
{/if}

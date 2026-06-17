<script lang="ts">
	import type { PageData } from './$types';
	import SearchBar from '$lib/components/SearchBar.svelte';

	let { data }: { data: PageData } = $props();

	type View = 'vault' | 'recent';
	let view = $state<View>('vault');

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

<SearchBar />

<header class="flex items-end justify-between gap-3 px-5 pt-2 pb-3">
	<div class="min-w-0">
		<p class="text-xs tracking-widest text-secondary uppercase">
			{view === 'recent' ? 'Recent visits' : 'Your vault'}
		</p>
		<p class="text-sm text-tertiary">
			{#if view === 'recent'}
				{visitedCount} of {data.restaurants.length} visited
			{:else}
				{data.restaurants.length}
				{data.restaurants.length === 1 ? 'restaurant' : 'restaurants'}
			{/if}
		</p>
	</div>
	{#if data.restaurants.length > 0}
		<div class="flex shrink-0 items-center gap-2">
			<div class="flex rounded-xl border border-line bg-panel/60 p-0.5 text-xs">
				<button
					type="button"
					onclick={() => (view = 'vault')}
					class="rounded-[10px] px-2.5 py-1 {view === 'vault'
						? 'bg-panel-2 text-primary'
						: 'text-secondary'}"
				>
					A–Z
				</button>
				<button
					type="button"
					onclick={() => (view = 'recent')}
					class="rounded-[10px] px-2.5 py-1 {view === 'recent'
						? 'bg-panel-2 text-primary'
						: 'text-secondary'}"
				>
					Recent
				</button>
			</div>
			<a
				href="/map"
				class="rounded-xl border border-line bg-panel/60 px-3 py-1.5 text-xs text-secondary"
			>
				Map
			</a>
		</div>
	{/if}
</header>

{#if data.restaurants.length === 0}
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
	<section class="grid gap-3 px-5 pb-10">
		{#each restaurants as r (r.uuid)}
			{@const showUser = data.preferences.show_review_summary && r.visitSummary.count > 0}
			{@const userRating = showUser ? (r.visitSummary.latest?.rating ?? null) : null}
			{@const userPhoto = showUser ? (r.visitSummary.latest?.photo ?? null) : null}
			<a
				href={`/restaurant/${r.uuid}`}
				class="block min-w-0 rounded-2xl border border-line bg-panel/50 p-4 {showUser
					? 'ring-1 ring-rating/20'
					: ''}"
			>
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0 flex-1">
						<h2 class="truncate text-base font-medium text-primary">{r.name}</h2>
						{#if r.suburb || r.address}
							<p class="mt-0.5 truncate text-xs text-secondary">{r.suburb ?? r.address}</p>
						{/if}
					</div>
					{#if userRating != null || userPhoto}
						<div class="flex shrink-0 items-center gap-2">
							{#if userRating != null}
								<span class="text-sm text-rating">★ {userRating}</span>
							{/if}
							{#if userPhoto}
								<img
									src={thumbUrl(userPhoto)}
									alt=""
									loading="lazy"
									class="h-10 w-10 rounded-lg bg-panel-2 object-cover"
									onerror={(e) => {
										const t = e.currentTarget as HTMLImageElement;
										const full = fullAttachmentUrl(userPhoto);
										if (t.src !== full) t.src = full;
									}}
								/>
							{/if}
						</div>
					{:else if r.rating != null}
						<span class="shrink-0 text-sm text-rating">★ {r.rating}</span>
					{/if}
				</div>
				{#if r.cuisine.length > 0 || r.tags.length > 0}
					<div class="mt-2 flex flex-wrap gap-1">
						{#each r.cuisine as c (c)}
							<span class="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-secondary">{c}</span>
						{/each}
						{#each r.tags as t (t)}
							<span class="rounded-full bg-panel-2/60 px-2 py-0.5 text-xs text-secondary"
								>#{t}</span
							>
						{/each}
					</div>
				{/if}
				{#if r.lists.length > 0}
					<p class="mt-2 truncate text-xs text-tertiary">in {r.lists.join(' · ')}</p>
				{/if}
				{#if view === 'recent'}
					<p class="mt-2 text-xs {r.visitSummary.latest ? 'text-secondary' : 'text-tertiary'}">
						{#if r.visitSummary.latest}
							Visited {shortVisitDate(r.visitSummary.latest.date)}
							{#if r.visitSummary.count > 1} · {r.visitSummary.count} visits{/if}
						{:else}
							Not visited yet
						{/if}
					</p>
				{/if}
			</a>
		{/each}
	</section>
{/if}

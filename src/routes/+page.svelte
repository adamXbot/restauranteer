<script lang="ts">
	import type { PageData } from './$types';
	import SearchBar from '$lib/components/SearchBar.svelte';

	let { data }: { data: PageData } = $props();

	function thumbUrl(relativePath: string): string {
		const rel = relativePath.replace(/^_attachments\//, '');
		const stem = rel.replace(/\.(jpg|jpeg|png|webp)$/i, '');
		return `/api/attachments/${encodeURI(`${stem}.thumb.jpg`)}`;
	}
	function fullAttachmentUrl(relativePath: string): string {
		const rel = relativePath.replace(/^_attachments\//, '');
		return `/api/attachments/${encodeURI(rel)}`;
	}
</script>

<SearchBar />

<header class="flex items-end justify-between gap-3 px-5 pt-2 pb-3">
	<div class="min-w-0">
		<p class="text-xs tracking-widest text-slate-400 uppercase">Your vault</p>
		<p class="text-sm text-slate-500">
			{data.restaurants.length}
			{data.restaurants.length === 1 ? 'restaurant' : 'restaurants'}
		</p>
	</div>
	{#if data.restaurants.length > 0}
		<a
			href="/map"
			class="shrink-0 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-200"
		>
			Map
		</a>
	{/if}
</header>

{#if data.restaurants.length === 0}
	<section class="px-5 pb-10">
		<div class="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-6">
			<h2 class="text-base font-medium text-slate-100">Nothing here yet</h2>
			<p class="mt-2 text-sm text-slate-400">
				Search above to find a restaurant on Google, then tap "Add to vault" — or drop a markdown
				file with frontmatter into your vault's <code
					class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-200">Restaurants/</code
				> folder.
			</p>
		</div>
	</section>
{:else}
	<section class="grid gap-3 px-5 pb-10">
		{#each data.restaurants as r (r.uuid)}
			{@const showUser = data.preferences.show_review_summary && r.visitSummary.count > 0}
			{@const userRating = showUser ? (r.visitSummary.latest?.rating ?? null) : null}
			{@const userPhoto = showUser ? (r.visitSummary.latest?.photo ?? null) : null}
			<a
				href={`/restaurant/${r.uuid}`}
				class="block min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 {showUser
					? 'ring-1 ring-amber-500/20'
					: ''}"
			>
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0 flex-1">
						<h2 class="truncate text-base font-medium text-slate-100">{r.name}</h2>
						{#if r.suburb || r.address}
							<p class="mt-0.5 truncate text-xs text-slate-400">{r.suburb ?? r.address}</p>
						{/if}
					</div>
					{#if userRating != null || userPhoto}
						<div class="flex shrink-0 items-center gap-2">
							{#if userRating != null}
								<span class="text-sm text-amber-300">★ {userRating}</span>
							{/if}
							{#if userPhoto}
								<img
									src={thumbUrl(userPhoto)}
									alt=""
									loading="lazy"
									class="h-10 w-10 rounded-lg bg-slate-800 object-cover"
									onerror={(e) => {
										const t = e.currentTarget as HTMLImageElement;
										const full = fullAttachmentUrl(userPhoto);
										if (t.src !== full) t.src = full;
									}}
								/>
							{/if}
						</div>
					{:else if r.rating != null}
						<span class="shrink-0 text-sm text-amber-300">★ {r.rating}</span>
					{/if}
				</div>
				{#if r.cuisine.length > 0 || r.tags.length > 0}
					<div class="mt-2 flex flex-wrap gap-1">
						{#each r.cuisine as c (c)}
							<span class="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{c}</span>
						{/each}
						{#each r.tags as t (t)}
							<span class="rounded-full bg-slate-800/60 px-2 py-0.5 text-xs text-slate-400"
								>#{t}</span
							>
						{/each}
					</div>
				{/if}
				{#if r.lists.length > 0}
					<p class="mt-2 truncate text-xs text-slate-500">in {r.lists.join(' · ')}</p>
				{/if}
			</a>
		{/each}
	</section>
{/if}

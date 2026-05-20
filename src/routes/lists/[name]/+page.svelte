<script lang="ts">
	import type { PageData } from './$types';
	import BackLink from '$lib/components/BackLink.svelte';
	import CopyMarkdownButton from '$lib/components/CopyMarkdownButton.svelte';

	let { data }: { data: PageData } = $props();

	async function fetchBundle(): Promise<string> {
		const res = await fetch(`/api/lists/${encodeURIComponent(data.name)}/bundle`);
		if (!res.ok) throw new Error(`Failed to bundle list (${res.status})`);
		return await res.text();
	}
</script>

<header class="px-5 pt-6 pb-3">
	<BackLink href="/lists" label="All lists" />
	<div class="mt-2 flex items-start justify-between gap-3">
		<h1 class="text-2xl font-semibold text-slate-50">
			{#if data.meta?.icon}<span class="mr-1">{data.meta.icon}</span>{/if}{data.name}
		</h1>
		<CopyMarkdownButton
			text={null}
			fetch={fetchBundle}
			title={`${data.name} (restauranteer list)`}
			label="Copy markdown"
		/>
	</div>
	<p class="mt-1 text-sm text-slate-400">
		{data.restaurants.length}
		{data.restaurants.length === 1 ? 'restaurant' : 'restaurants'}
	</p>
	{#if data.meta?.notes}
		<p class="mt-2 text-sm text-slate-300">{data.meta.notes}</p>
	{/if}
	{#if data.meta?.source_url}
		<a
			href={data.meta.source_url}
			target="_blank"
			rel="noopener noreferrer"
			class="mt-1 inline-block text-[11px] text-slate-500 underline decoration-slate-700 underline-offset-2"
		>
			Imported from Google Maps ↗
		</a>
	{/if}
</header>

<section class="grid gap-3 px-5 pb-10">
	{#each data.restaurants as r (r.uuid)}
		<a
			href={`/restaurant/${r.uuid}`}
			class="block min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-4"
		>
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0 flex-1">
					<h2 class="truncate text-base font-medium text-slate-100">{r.name}</h2>
					{#if r.suburb || r.address}
						<p class="mt-0.5 truncate text-xs text-slate-400">{r.suburb ?? r.address}</p>
					{/if}
				</div>
				{#if r.rating != null}
					<span class="shrink-0 text-sm text-amber-300">★ {r.rating}</span>
				{/if}
			</div>
		</a>
	{/each}
</section>

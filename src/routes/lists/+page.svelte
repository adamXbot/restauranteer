<script lang="ts">
	import type { PageData } from './$types';
	import BackLink from '$lib/components/BackLink.svelte';

	let { data }: { data: PageData } = $props();
</script>

<header class="px-5 pt-6 pb-3">
	<BackLink href="/" />
	<h1 class="mt-2 text-2xl font-semibold text-slate-50">Lists</h1>
	<p class="mt-1 text-sm text-slate-400">
		{data.lists.length}
		{data.lists.length === 1 ? 'list' : 'lists'}
	</p>
</header>

{#if data.lists.length === 0}
	<section class="px-5 pb-10">
		<div class="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-6">
			<p class="text-sm text-slate-400">
				No lists yet. Open a restaurant and tap "Edit lists" to start one.
			</p>
		</div>
	</section>
{:else}
	<section class="grid grid-cols-2 gap-3 px-5 pb-10">
		{#each data.lists as l (l.name)}
			<a
				href={`/lists/${encodeURIComponent(l.name)}`}
				class="flex h-28 flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
			>
				<h2 class="line-clamp-2 text-sm font-medium text-slate-100">{l.name}</h2>
				<p class="text-xs text-slate-500">
					{l.count}
					{l.count === 1 ? 'restaurant' : 'restaurants'}
				</p>
			</a>
		{/each}
	</section>
{/if}

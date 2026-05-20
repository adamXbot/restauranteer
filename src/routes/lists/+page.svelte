<script lang="ts">
	import type { PageData } from './$types';
	import BackLink from '$lib/components/BackLink.svelte';

	let { data }: { data: PageData } = $props();
</script>

<header class="px-5 pt-6 pb-3">
	<BackLink href="/" />
	<h1 class="mt-2 text-2xl font-semibold text-primary">Lists</h1>
	<p class="mt-1 text-sm text-secondary">
		{data.lists.length}
		{data.lists.length === 1 ? 'list' : 'lists'}
	</p>
</header>

{#if data.lists.length === 0}
	<section class="px-5 pb-10">
		<div class="rounded-2xl border border-dashed border-line-strong bg-panel/30 p-6">
			<p class="text-sm text-secondary">
				No lists yet. Open a restaurant and tap "Edit lists" to start one.
			</p>
		</div>
	</section>
{:else}
	<section class="grid grid-cols-2 gap-3 px-5 pb-10">
		{#each data.lists as l (l.name)}
			<a
				href={`/lists/${encodeURIComponent(l.name)}`}
				class="flex h-28 flex-col justify-between rounded-2xl border border-line bg-panel/60 p-4"
			>
				<h2 class="line-clamp-2 text-sm font-medium text-primary">{l.name}</h2>
				<p class="text-xs text-tertiary">
					{l.count}
					{l.count === 1 ? 'restaurant' : 'restaurants'}
				</p>
			</a>
		{/each}
	</section>
{/if}

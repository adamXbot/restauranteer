<script lang="ts">
	import type { PlaceReview } from '$lib/server/providers/google';

	let { reviews }: { reviews: PlaceReview[] } = $props();
</script>

<ol class="mt-2 space-y-3">
	{#each reviews as r, i (`${i}-${r.author}`)}
		<li class="rounded-xl border border-line bg-panel/40 p-3">
			<div class="flex items-center justify-between gap-2">
				<span class="text-xs font-medium text-secondary">{r.author}</span>
				<span class="text-xs text-rating">★ {r.rating}</span>
			</div>
			<p class="mt-1 line-clamp-5 text-sm text-secondary">{r.text}</p>
			{#if r.relative_time}
				<p class="mt-1 text-[10px] text-tertiary">{r.relative_time}</p>
			{/if}
		</li>
	{/each}
</ol>

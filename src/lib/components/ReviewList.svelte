<script lang="ts">
	import type { PlaceReview } from '$lib/server/providers/google';

	let { reviews }: { reviews: PlaceReview[] } = $props();
</script>

<ol class="mt-2 space-y-3">
	{#each reviews as r, i (`${i}-${r.author}`)}
		<li class="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
			<div class="flex items-center justify-between gap-2">
				<span class="text-xs font-medium text-slate-200">{r.author}</span>
				<span class="text-xs text-amber-300">★ {r.rating}</span>
			</div>
			<p class="mt-1 line-clamp-5 text-sm text-slate-300">{r.text}</p>
			{#if r.relative_time}
				<p class="mt-1 text-[10px] text-slate-500">{r.relative_time}</p>
			{/if}
		</li>
	{/each}
</ol>

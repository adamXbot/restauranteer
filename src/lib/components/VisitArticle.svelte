<script lang="ts">
	import { lightboxImages } from '$lib/photoswipe';

	type Visit = { index: number; html: string };
	type Props = {
		visit: Visit;
		uuid: string;
		dishPhotosCollapsed?: boolean;
		onShare?: () => void;
	};
	let { visit, uuid, dishPhotosCollapsed = false, onShare }: Props = $props();
</script>

<article use:lightboxImages class="md-visit md-body" class:dishes-collapsed={dishPhotosCollapsed}>
	{@html visit.html}
	<div class="mt-1 flex flex-wrap gap-2">
		{#if onShare}
			<button
				type="button"
				onclick={() => onShare?.()}
				class="inline-flex items-center gap-1 rounded-full border border-line-strong bg-panel/70 px-3 py-1 text-xs text-secondary hover:bg-panel-2 hover:text-primary"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5" aria-hidden="true">
					<path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" />
				</svg>
				Share
			</button>
		{/if}
		<a
			href={`/restaurant/${uuid}/visit/${visit.index}/edit`}
			class="inline-flex items-center gap-1 rounded-full border border-line-strong bg-panel/70 px-3 py-1 text-xs text-secondary hover:bg-panel-2 hover:text-primary"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5" aria-hidden="true">
				<path d="M11 4H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-6" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
			</svg>
			Edit
		</a>
	</div>
</article>

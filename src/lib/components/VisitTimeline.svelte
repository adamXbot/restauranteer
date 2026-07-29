<script lang="ts" generics="V extends { index: number; date: string; meal: string | null; rating: number | null; excerpt: string | null; html: string }">
	import VisitArticle from './VisitArticle.svelte';

	type Props = {
		visits: V[];
		uuid: string;
		dishPhotosCollapsed?: boolean;
		onShare?: (visit: V) => void;
	};
	let { visits, uuid, dishPhotosCollapsed = false, onShare }: Props = $props();

	let expanded = $state<Set<number>>(new Set());
	function toggle(index: number) {
		const next = new Set(expanded);
		if (next.has(index)) next.delete(index);
		else next.add(index);
		expanded = next;
	}

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	function fmt(iso: string): string {
		const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!m) return iso;
		return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])} ${m[1]}`;
	}
</script>

<ul class="relative">
	{#each visits as v, i (v.index)}
		{@const isOpen = expanded.has(v.index)}
		<li class="relative flex gap-3 pb-1">
			<!-- timeline spine -->
			<div class="flex w-4 flex-none flex-col items-center pt-1.5">
				<span class="h-2 w-2 rounded-full bg-accent"></span>
				{#if i < visits.length - 1}
					<span class="mt-1 w-px flex-1 bg-line-strong"></span>
				{/if}
			</div>
			<div class="min-w-0 flex-1 pb-4">
				<button
					type="button"
					onclick={() => toggle(v.index)}
					aria-expanded={isOpen}
					class="flex w-full items-start justify-between gap-3 text-left"
				>
					<div class="min-w-0">
						<p class="text-sm font-medium text-primary">
							{fmt(v.date)}{#if v.meal}<span class="font-normal text-tertiary"> · {v.meal}</span>{/if}
						</p>
						{#if v.excerpt}
							<p class="mt-0.5 line-clamp-1 text-xs text-secondary">{v.excerpt}</p>
						{/if}
					</div>
					<span class="flex shrink-0 items-center gap-2">
						{#if v.rating != null}
							<span class="text-sm text-rating">★ {v.rating}</span>
						{/if}
						<svg
							viewBox="0 0 24 24"
							class="h-4 w-4 text-tertiary transition-transform {isOpen ? 'rotate-180' : ''}"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M6 9l6 6 6-6" />
						</svg>
					</span>
				</button>
				{#if isOpen}
					<div class="mt-3">
						<VisitArticle visit={v} {uuid} {dishPhotosCollapsed} onShare={onShare ? () => onShare(v) : undefined} />
					</div>
				{/if}
			</div>
		</li>
	{/each}
</ul>

<script lang="ts">
	type Props = {
		href: string;
		name: string;
		subtitle?: string | null;
		rating?: number | null;
		photoThumb?: string | null;
		photoFull?: string | null;
		cuisine?: string[];
		tags?: string[];
		lists?: string[];
		footer?: string | null;
		highlight?: boolean;
		/** 'list' only changes layout at lg+; below that both views render the same card. */
		view?: 'grid' | 'list';
	};
	let {
		href,
		name,
		subtitle = null,
		rating = null,
		photoThumb = null,
		photoFull = null,
		cuisine = [],
		tags = [],
		lists = [],
		footer = null,
		highlight = false,
		view = 'grid'
	}: Props = $props();

	const monogram = $derived((name.trim()[0] ?? '?').toUpperCase());

	function onImgError(e: Event) {
		const t = e.currentTarget as HTMLImageElement;
		if (photoFull && t.src !== photoFull) t.src = photoFull;
	}
</script>

<a
	{href}
	class="group flex min-w-0 flex-col rounded-2xl border border-line bg-panel/50 p-4 transition-colors hover:border-line-strong hover:bg-panel/70 {highlight
		? 'ring-1 ring-rating/20'
		: ''} {view === 'list' ? 'lg:flex-row lg:items-center lg:gap-4 lg:p-3.5' : ''}"
>
	{#if view === 'list'}
		<!-- Leading thumbnail — desktop list rows only -->
		<div
			class="hidden shrink-0 items-center justify-center overflow-hidden rounded-xl bg-panel-2 lg:order-first lg:flex lg:h-14 lg:w-14"
		>
			{#if photoThumb}
				<img
					src={photoThumb}
					alt=""
					loading="lazy"
					class="h-full w-full object-cover"
					onerror={onImgError}
				/>
			{:else}
				<span class="text-lg font-semibold text-tertiary">{monogram}</span>
			{/if}
		</div>
	{/if}

	<div class="flex min-w-0 flex-1 flex-col gap-2">
		<div class="flex items-start justify-between gap-3">
			<h2 class="min-w-0 flex-1 text-base font-medium break-words text-primary">{name}</h2>
			{#if rating != null}
				<span class="shrink-0 pt-0.5 text-sm text-rating">★ {rating}</span>
			{/if}
		</div>
		{#if subtitle}
			<p class="text-xs text-secondary">{subtitle}</p>
		{/if}
		{#if cuisine.length > 0 || tags.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each cuisine as c (c)}
					<span class="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-secondary">{c}</span>
				{/each}
				{#each tags as t (t)}
					<span class="rounded-full bg-panel-2/60 px-2 py-0.5 text-[11px] text-secondary">#{t}</span>
				{/each}
			</div>
		{/if}
		{#if lists.length > 0}
			<p class="truncate text-xs text-tertiary">in {lists.join(' · ')}</p>
		{/if}
		{#if footer}
			<p class="text-xs text-tertiary">{footer}</p>
		{/if}
	</div>

	{#if photoThumb}
		<!-- Photo below the text — always in grid; mobile-only in list (leading thumb takes over at lg) -->
		<div
			class="mt-3 h-28 w-full overflow-hidden rounded-xl bg-panel-2 {view === 'list' ? 'lg:hidden' : ''}"
		>
			<img
				src={photoThumb}
				alt=""
				loading="lazy"
				class="h-full w-full object-cover"
				onerror={onImgError}
			/>
		</div>
	{/if}
</a>

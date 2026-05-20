<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title: string;
		meta?: string;
		defaultOpen?: boolean;
		children: Snippet;
	};

	let { title, meta, defaultOpen = false, children }: Props = $props();
</script>

<details class="group rounded-2xl border border-line bg-panel/40" open={defaultOpen}>
	<summary
		class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left hover:bg-panel/60"
	>
		<span class="min-w-0">
			<span class="block text-xs tracking-widest text-secondary uppercase">{title}</span>
			{#if meta}
				<span class="mt-0.5 block truncate text-[11px] text-tertiary">{meta}</span>
			{/if}
		</span>
		<span class="shrink-0 text-tertiary transition-transform group-open:rotate-180" aria-hidden="true">
			⌄
		</span>
	</summary>
	<div class="border-t border-line px-4 pt-3 pb-4">
		{@render children()}
	</div>
</details>

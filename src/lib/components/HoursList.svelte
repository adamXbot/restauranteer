<script lang="ts">
	let { lines }: { lines: string[] } = $props();
</script>

<ul class="mt-2 space-y-1 text-sm text-secondary">
	{#each lines as line (line)}
		{@const idx = line.indexOf(':')}
		<li class="flex items-baseline gap-2">
			{#if idx > 0}
				<span class="w-20 shrink-0 text-xs text-tertiary">{line.slice(0, idx)}</span>
				<span>{line.slice(idx + 1).trim()}</span>
			{:else}
				<span>{line}</span>
			{/if}
		</li>
	{/each}
</ul>

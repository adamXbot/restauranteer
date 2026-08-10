<script lang="ts">
	/**
	 * The "why this matched" line under a vault search result: the snippet
	 * with each matched token in the accent color, prefixed by a small field
	 * glyph. Name/alias matches render nothing — the visible title is the
	 * answer, so repeating it would be noise.
	 */
	import { searchRuns, collapseRun } from '$lib/searchText';

	let {
		field,
		snippet
	}: { field: string | null; snippet: string | null } = $props();

	// Tags column carries tags, cuisine AND list names; body is the note the
	// user wrote; address is the street line.
	const GLYPHS: Record<string, string> = {
		tags: '🏷',
		body: '❝',
		address: '📍'
	};

	let glyph = $derived(field ? (GLYPHS[field] ?? null) : null);
	let runs = $derived(snippet ? searchRuns(snippet).map((r) => ({ ...r, text: collapseRun(r.text) })) : []);
</script>

{#if snippet && glyph}
	<p class="mt-0.5 flex items-baseline gap-1 text-xs text-tertiary">
		<span aria-hidden="true" class="shrink-0 opacity-70">{glyph}</span>
		<span class="line-clamp-2">
			{#each runs as run, i (i)}{#if run.highlighted}<span
					class="font-semibold text-accent">{run.text}</span
				>{:else}{run.text}{/if}{/each}
		</span>
	</p>
{/if}

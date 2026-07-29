<script lang="ts">
	import { connectivity } from '$lib/connectivity.svelte';
</script>

{#if !connectivity.online}
	<div
		role="status"
		class="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning"
	>
		<span aria-hidden="true" class="text-sm leading-none">●</span>
		<span>
			Offline — showing saved data. New visits are queued; other changes can't be saved until you
			reconnect.
		</span>
	</div>
{/if}

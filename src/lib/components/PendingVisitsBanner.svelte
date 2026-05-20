<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { countPending, flushQueue } from '$lib/visitQueue';

	let count = $state(0);
	let busy = $state(false);
	let lastMsg = $state<string | null>(null);

	async function refreshCount() {
		try {
			count = await countPending();
		} catch {
			count = 0;
		}
	}

	onMount(() => {
		refreshCount();
		const onOnline = () => {
			void sync({ silent: true });
		};
		window.addEventListener('online', onOnline);
		return () => window.removeEventListener('online', onOnline);
	});

	export async function sync(opts: { silent?: boolean } = {}) {
		if (busy) return;
		busy = true;
		try {
			const result = await flushQueue();
			if (!opts.silent) {
				if (result.succeeded > 0 && result.failed === 0) {
					lastMsg = `Synced ${result.succeeded}`;
				} else if (result.succeeded > 0) {
					lastMsg = `Synced ${result.succeeded}, ${result.failed} still pending`;
				} else if (result.attempted > 0) {
					lastMsg = `${result.failed} still pending`;
				}
			}
			if (result.succeeded > 0) await invalidateAll();
			await refreshCount();
		} catch {
			lastMsg = 'Sync failed';
		} finally {
			busy = false;
		}
	}
</script>

{#if count > 0}
	<div
		class="mx-5 mt-3 flex items-center justify-between gap-2 rounded-xl border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
	>
		<span>
			{count}
			{count === 1 ? 'visit' : 'visits'} queued offline
			{#if lastMsg}<span class="ml-1 text-amber-300/80">· {lastMsg}</span>{/if}
		</span>
		<button
			type="button"
			onclick={() => sync()}
			disabled={busy}
			class="rounded-lg border border-amber-700/60 px-2 py-1 text-amber-100 disabled:opacity-50"
		>
			{busy ? 'Syncing…' : '↻ Sync now'}
		</button>
	</div>
{/if}

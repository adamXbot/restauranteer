<script lang="ts">
	import { onMount } from 'svelte';
	import type { VisitSummary } from '$lib/server/vault/visit';

	let { summary }: { summary: VisitSummary } = $props();

	type Mode = 'latest' | 'earliest' | 'average';
	const STORAGE_KEY = 'reviewSummaryMode';

	let mode = $state<Mode>('latest');

	onMount(() => {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved === 'latest' || saved === 'earliest' || saved === 'average') mode = saved;
		} catch {
			// ignore
		}
	});

	const availableModes = $derived<Mode[]>(
		[
			summary.latest?.rating != null ? 'latest' : null,
			summary.earliest?.rating != null ? 'earliest' : null,
			summary.average != null ? 'average' : null
		].filter((m): m is Mode => m !== null)
	);
	const effectiveMode = $derived<Mode>(
		availableModes.includes(mode) ? mode : (availableModes[0] ?? 'latest')
	);
	const canCycle = $derived(summary.count > 1 && availableModes.length > 1);

	function cycle() {
		if (!canCycle) return;
		const idx = availableModes.indexOf(effectiveMode);
		const next = availableModes[(idx + 1) % availableModes.length];
		mode = next;
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// ignore
		}
	}

	function shortDate(iso: string): string {
		const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!m) return iso;
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
	}

	const rating = $derived(
		effectiveMode === 'average'
			? summary.average
			: effectiveMode === 'latest'
				? (summary.latest?.rating ?? null)
				: (summary.earliest?.rating ?? null)
	);
	const label = $derived(
		summary.count === 1
			? '1 visit'
			: availableModes.length === 0
				? `${summary.count} visits`
				: effectiveMode === 'average'
					? `avg · ${summary.count}`
					: effectiveMode === 'latest'
						? `latest · ${shortDate(summary.latest!.date)}`
						: `earliest · ${shortDate(summary.earliest!.date)}`
	);
</script>

{#if summary.count > 0}
	<button
		type="button"
		onclick={cycle}
		disabled={!canCycle}
		aria-label="Review summary{canCycle ? ' — tap to cycle' : ''}"
		class="shrink-0 rounded-xl border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-right leading-tight disabled:cursor-default"
	>
		<span class="block text-sm font-medium text-amber-300">
			{#if rating != null}★ {rating}{:else}★{/if}
		</span>
		<span class="block text-[10px] tracking-wide text-slate-500 lowercase">{label}</span>
	</button>
{/if}

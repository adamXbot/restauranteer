<script lang="ts">
	import { formatDistance } from '$lib/geo';

	type Candidate = {
		uuid: string;
		name: string;
		suburb: string | null;
		address: string | null;
		score: number;
		distance_m: number | null;
		reason: 'exact_name' | 'name_subset' | 'token_overlap';
	};
	type Preview = {
		name: string;
		address: string | null;
		lat: number | null;
		lng: number | null;
	};

	type Props = {
		candidates: Candidate[];
		preview: Preview;
		sourceLabel: string;
		busy?: boolean;
		onPick: (uuid: string) => void;
		onCreate: () => void;
		onClose: () => void;
	};

	let { candidates, preview, sourceLabel, busy = false, onPick, onCreate, onClose }: Props =
		$props();

	function reasonLabel(c: Candidate): string {
		if (c.reason === 'exact_name') return 'same name';
		if (c.reason === 'name_subset') return 'name overlap';
		return 'similar name';
	}
</script>

<div
	class="fixed inset-0 z-40 flex flex-col justify-end bg-slate-950/70"
	role="dialog"
	aria-modal="true"
>
	<button
		type="button"
		class="absolute inset-0 -z-10 h-full w-full cursor-default"
		aria-label="Close"
		onclick={onClose}
	></button>
	<section class="rounded-t-3xl border-t border-slate-800 bg-slate-900 p-5 pb-8">
		<header class="mb-3 flex items-center justify-between">
			<h2 class="text-base font-medium text-slate-100">Possible match</h2>
			<button type="button" onclick={onClose} class="text-xs text-slate-400">Cancel</button>
		</header>

		<p class="mb-3 text-sm text-slate-400">
			You're importing <span class="font-medium text-slate-100">{preview.name}</span> from
			{sourceLabel}.
			{#if preview.address}<span class="text-slate-500"> — {preview.address}</span>{/if}
		</p>

		<p class="mb-2 text-xs tracking-widest text-slate-500 uppercase">Already in your vault?</p>

		<ul class="space-y-1.5">
			{#each candidates as c (c.uuid)}
				<li>
					<button
						type="button"
						onclick={() => onPick(c.uuid)}
						disabled={busy}
						class="flex w-full items-start justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left disabled:opacity-50"
					>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-slate-100">{c.name}</p>
							{#if c.suburb || c.address}
								<p class="truncate text-xs text-slate-500">{c.suburb ?? c.address}</p>
							{/if}
							<p class="mt-0.5 text-[10px] text-slate-500">
								{reasonLabel(c)}{#if c.distance_m != null}
									· {formatDistance(c.distance_m)} away
								{/if}
							</p>
						</div>
						<span class="shrink-0 text-xs text-orange-400">Merge →</span>
					</button>
				</li>
			{/each}
		</ul>

		<button
			type="button"
			onclick={onCreate}
			disabled={busy}
			class="mt-4 w-full rounded-2xl bg-orange-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
		>
			Create a new entry instead
		</button>
	</section>
</div>

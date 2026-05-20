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
	class="fixed inset-0 z-40 flex flex-col justify-end bg-overlay"
	role="dialog"
	aria-modal="true"
>
	<button
		type="button"
		class="absolute inset-0 -z-10 h-full w-full cursor-default"
		aria-label="Close"
		onclick={onClose}
	></button>
	<section class="rounded-t-3xl border-t border-line bg-panel p-5 pb-8">
		<header class="mb-3 flex items-center justify-between">
			<h2 class="text-base font-medium text-primary">Possible match</h2>
			<button type="button" onclick={onClose} class="text-xs text-secondary">Cancel</button>
		</header>

		<p class="mb-3 text-sm text-secondary">
			<span class="font-medium text-primary">{preview.name}</span> · {sourceLabel}
			{#if preview.address}<span class="text-tertiary"> — {preview.address}</span>{/if}
		</p>

		<p class="mb-2 text-xs tracking-widest text-tertiary uppercase">Already in your vault?</p>

		<ul class="space-y-1.5">
			{#each candidates as c (c.uuid)}
				<li>
					<button
						type="button"
						onclick={() => onPick(c.uuid)}
						disabled={busy}
						class="flex w-full items-start justify-between gap-2 rounded-xl border border-line bg-panel/60 px-3 py-2.5 text-left disabled:opacity-50"
					>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-primary">{c.name}</p>
							{#if c.suburb || c.address}
								<p class="truncate text-xs text-tertiary">{c.suburb ?? c.address}</p>
							{/if}
							<p class="mt-0.5 text-[10px] text-tertiary">
								{reasonLabel(c)}{#if c.distance_m != null}
									· {formatDistance(c.distance_m)} away
								{/if}
							</p>
						</div>
						<span class="shrink-0 text-xs text-accent">Merge →</span>
					</button>
				</li>
			{/each}
		</ul>

		<button
			type="button"
			onclick={onCreate}
			disabled={busy}
			class="mt-4 w-full rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-on-accent disabled:opacity-50"
		>
			Create new
		</button>
	</section>
</div>

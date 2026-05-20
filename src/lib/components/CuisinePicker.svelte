<script lang="ts">
	type Props = {
		all: string[];
		selected: string[];
		onApply?: (selected: string[]) => void;
		onClose?: () => void;
	};
	let { all, selected: incoming, onApply, onClose }: Props = $props();

	// svelte-ignore state_referenced_locally
	let selected = $state<Set<string>>(new Set(incoming));

	function toggle(name: string) {
		const next = new Set(selected);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		selected = next;
	}

	function clear() {
		selected = new Set();
	}

	function apply() {
		onApply?.([...selected].sort((a, b) => a.localeCompare(b)));
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
		onclick={() => onClose?.()}
	></button>
	<section class="rounded-t-3xl border-t border-slate-800 bg-slate-900 p-5 pb-8">
		<header class="mb-3 flex items-center justify-between">
			<h2 class="text-base font-medium text-slate-100">Cuisine</h2>
			<button type="button" onclick={() => onClose?.()} class="text-xs text-slate-400">Cancel</button>
		</header>

		<div class="flex flex-wrap gap-1.5">
			{#each all as c (c)}
				{@const on = selected.has(c)}
				<button
					type="button"
					onclick={() => toggle(c)}
					class="rounded-full px-2.5 py-1 text-xs"
					class:bg-orange-600={on}
					class:text-white={on}
					class:bg-slate-800={!on}
					class:text-slate-300={!on}
				>
					{c}
				</button>
			{/each}
		</div>

		<div class="mt-4 flex gap-2">
			<button
				type="button"
				onclick={clear}
				class="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300"
			>
				Any
			</button>
			<button
				type="button"
				onclick={apply}
				class="flex-1 rounded-xl bg-orange-600 px-3 py-2 text-sm font-medium text-white"
			>
				Apply
			</button>
		</div>
	</section>
</div>

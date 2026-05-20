<script lang="ts">
	type Props = {
		value: number;
		max?: number;
		label?: string;
		onchange?: (value: number) => void;
	};
	let { value, max = 5, label, onchange }: Props = $props();

	function pick(n: number) {
		const next = value === n ? 0 : n;
		onchange?.(next);
	}
</script>

<div class="flex items-center gap-2" role="radiogroup" aria-label={label ?? 'Rating'}>
	<div class="flex gap-0.5">
		{#each Array(max) as _, i (i)}
			{@const n = i + 1}
			<button
				type="button"
				onclick={() => pick(n)}
				aria-label={`${n} stars`}
				aria-checked={value === n}
				role="radio"
				class="text-xl leading-none"
				class:text-rating={n <= value}
				class:text-tertiary={n > value}
			>
				{n <= value ? '★' : '☆'}
			</button>
		{/each}
	</div>
	<span class="text-xs text-tertiary w-8">
		{value > 0 ? `${value}/${max}` : ''}
	</span>
</div>

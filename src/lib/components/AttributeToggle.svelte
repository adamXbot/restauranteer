<script lang="ts">
	import type { AttributeValue } from '$lib/attributes';

	type ToggleValue = AttributeValue | null;
	type Props = {
		value: ToggleValue;
		label: string;
		unsetLabel?: string;
		onchange: (next: ToggleValue) => void;
		disabled?: boolean;
		size?: 'sm' | 'md';
	};

	let {
		value,
		label,
		unsetLabel = 'Unset',
		onchange,
		disabled = false,
		size = 'md'
	}: Props = $props();

	const states = $derived<Array<{ id: ToggleValue; glyph: string; aria: string }>>([
		{ id: 'no', glyph: '✕', aria: 'No' },
		{ id: null, glyph: '–', aria: unsetLabel },
		{ id: 'yes', glyph: '✓', aria: 'Yes' }
	]);

	function set(next: ToggleValue) {
		if (disabled) return;
		onchange(next);
	}
</script>

<div
	role="radiogroup"
	aria-label={label}
	class="inline-flex overflow-hidden rounded-lg border border-line bg-panel/40 text-sm"
	class:opacity-60={disabled}
>
	{#each states as state (state.id ?? 'unset')}
		{@const active = value === state.id}
		<button
			type="button"
			role="radio"
			aria-checked={active}
			aria-label={`${label}: ${state.aria}`}
			tabindex={active ? 0 : -1}
			disabled={disabled}
			onclick={() => set(state.id)}
			class="flex items-center justify-center border-r border-line/60 last:border-r-0 transition-colors"
			class:px-2.5={size === 'md'}
			class:py-1.5={size === 'md'}
			class:px-2={size === 'sm'}
			class:py-1={size === 'sm'}
			class:text-success={active && state.id === 'yes'}
			class:text-danger={active && state.id === 'no'}
			class:text-secondary={active && state.id === null}
			class:bg-success={false}
			class:bg-accent-soft={active}
			class:text-tertiary={!active}
		>
			<span aria-hidden="true" class="font-medium">{state.glyph}</span>
		</button>
	{/each}
</div>

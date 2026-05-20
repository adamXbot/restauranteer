<script lang="ts">
	import { shareOrCopy, type ShareOutcome } from '$lib/share';

	type Props = {
		url: string;
		title?: string;
		class?: string;
	};
	let { url, title, class: className = '' }: Props = $props();

	let outcome = $state<ShareOutcome | 'idle'>('idle');
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function onClick(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		const result = await shareOrCopy(url, title);
		outcome = result;
		if (timer) clearTimeout(timer);
		if (result !== 'cancelled') {
			timer = setTimeout(() => (outcome = 'idle'), 1600);
		}
	}

	const label = $derived(
		outcome === 'copied'
			? '✓ Copied'
			: outcome === 'shared'
				? '✓ Shared'
				: outcome === 'failed'
					? '× Failed'
					: outcome === 'cancelled'
						? 'Share'
						: 'Share'
	);
</script>

<button
	type="button"
	onclick={onClick}
	aria-label="Share or copy URL"
	class="text-xs text-slate-500 transition-colors hover:text-slate-300 {className}"
	class:!text-emerald-400={outcome === 'copied' || outcome === 'shared'}
	class:!text-red-400={outcome === 'failed'}
>
	{label}
</button>

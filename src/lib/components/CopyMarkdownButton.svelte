<script lang="ts">
	import { shareOrCopyText, type ShareOutcome } from '$lib/share';

	type Props = {
		/** Plain-text markdown to copy. If `null`, the button is disabled. */
		text: string | null;
		/** Optional async fetch — used when we don't want to ship the markdown until clicked. */
		fetch?: () => Promise<string>;
		title?: string;
		label?: string;
		class?: string;
	};
	let {
		text,
		fetch: fetchFn,
		title,
		label = 'Copy markdown',
		class: className = ''
	}: Props = $props();

	let outcome = $state<ShareOutcome | 'idle' | 'loading'>('idle');
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function onClick() {
		let payload = text;
		if (!payload && fetchFn) {
			outcome = 'loading';
			try {
				payload = await fetchFn();
			} catch (e) {
				outcome = 'failed';
				console.error(e);
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => (outcome = 'idle'), 1600);
				return;
			}
		}
		if (!payload) return;
		const result = await shareOrCopyText(payload, title);
		outcome = result;
		if (timer) clearTimeout(timer);
		if (result !== 'cancelled') {
			timer = setTimeout(() => (outcome = 'idle'), 1600);
		}
	}

	const display = $derived(
		outcome === 'copied'
			? '✓ Copied'
			: outcome === 'shared'
				? '✓ Shared'
				: outcome === 'failed'
					? '× Failed'
					: outcome === 'loading'
						? '…'
						: label
	);
</script>

<button
	type="button"
	onclick={onClick}
	disabled={(!text && !fetchFn) || outcome === 'loading'}
	aria-label={label}
	class="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-700 hover:text-slate-100 disabled:opacity-50 {className}"
	class:!text-emerald-400={outcome === 'copied' || outcome === 'shared'}
	class:!text-red-400={outcome === 'failed'}
>
	{display}
</button>

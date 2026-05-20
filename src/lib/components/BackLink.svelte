<script lang="ts">
	type Props = {
		href: string;
		label?: string;
	};
	let { href, label = 'Back' }: Props = $props();
</script>

<a
	{href}
	class="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800 hover:text-white"
>
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class="h-4 w-4"
		aria-hidden="true"
	>
		<path d="M15 18l-6-6 6-6" />
	</svg>
	<span>{label}</span>
</a>

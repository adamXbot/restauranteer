<script lang="ts">
	type Name = 'vault' | 'lists' | 'near' | 'map' | 'find' | 'settings' | 'inbox';
	let { name, class: cls = 'h-5 w-5' }: { name: Name; class?: string } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={cls}
	aria-hidden="true"
>
	{#if name === 'vault'}
		<path d="M3 10L12 3l9 7v10a1 1 0 01-1 1h-5v-7h-6v7H4a1 1 0 01-1-1V10z" />
	{:else if name === 'lists'}
		<path d="M8 6h13M8 12h13M8 18h13" />
		<circle cx="3.5" cy="6" r="0.6" fill="currentColor" />
		<circle cx="3.5" cy="12" r="0.6" fill="currentColor" />
		<circle cx="3.5" cy="18" r="0.6" fill="currentColor" />
	{:else if name === 'near'}
		<path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0118 0z" />
		<circle cx="12" cy="10" r="3" />
	{:else if name === 'map'}
		<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
		<path d="M9 4v14M15 6v14" />
	{:else if name === 'find'}
		<circle cx="11" cy="11" r="7" />
		<path d="M21 21l-4.35-4.35" />
	{:else if name === 'inbox'}
		<path d="M3 13l4-9h10l4 9" />
		<path d="M3 13v7a1 1 0 001 1h16a1 1 0 001-1v-7" />
		<path d="M3 13h5l1.5 3h5L16 13h5" />
	{:else if name === 'settings'}
		<circle cx="12" cy="12" r="3" />
		<path
			d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
		/>
	{/if}
</svg>

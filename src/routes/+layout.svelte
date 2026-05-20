<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import '../app.css';
	import PendingVisitsBanner from '$lib/components/PendingVisitsBanner.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	let banner: ReturnType<typeof PendingVisitsBanner> | undefined;

	onMount(() => {
		// Auto-flush on load if anything is pending
		setTimeout(() => banner?.sync({ silent: true }), 800);
	});
</script>

<PendingVisitsBanner bind:this={banner} />

<main class="mx-auto flex min-h-dvh max-w-3xl flex-col">
	{@render children()}
	<BottomNav inboxCount={data.inboxCount} />
</main>

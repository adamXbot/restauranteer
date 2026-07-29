<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		void goto('/discover', { replaceState: true });
	});
</script>

<section class="px-5 pt-8">
	<h1 class="text-2xl font-semibold text-primary">Map moved</h1>
	<p class="mt-1 text-sm text-secondary">Saved pins and nearby search now live in Discover.</p>
	<a
		href="/discover"
		class="mt-4 inline-flex rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent"
	>
		Open Discover
	</a>
</section>

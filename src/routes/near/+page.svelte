<script lang="ts">
	import type { PageData } from './$types';
	import BackLink from '$lib/components/BackLink.svelte';
	import NearMap from '$lib/components/NearMap.svelte';

	let { data }: { data: PageData } = $props();
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href="/" />
	<h1 class="mt-2 text-2xl font-semibold text-primary">Near me</h1>
	<p class="mt-1 text-sm text-secondary">Saved places are pinned. Tap a spot to search nearby.</p>
</header>

<NearMap
	preferences={data.preferences}
	appleAvailable={data.appleAvailable}
	googleMapsKey={data.googleMapsKey}
	mapboxToken={data.mapboxToken}
	googleEnabled={data.googleEnabled}
	allCuisines={data.cuisines}
	from="near"
/>

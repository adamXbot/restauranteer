<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import '../app.css';
	import PendingVisitsBanner from '$lib/components/PendingVisitsBanner.svelte';
	import OfflineBanner from '$lib/components/OfflineBanner.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import QuickAdd from '$lib/components/QuickAdd.svelte';
	import { buildManifestHref, buildThemeColors } from '$lib/theme';
	import { installTheme } from '$lib/themeRuntime';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	let banner: ReturnType<typeof PendingVisitsBanner> | undefined;
	const headBrightness = $derived(data.preferences.theme_mode === 'light' ? 'light' : 'dark');
	const headTheme = $derived(buildThemeColors(data.preferences, headBrightness));
	const manifestHref = $derived(buildManifestHref(data.preferences, headBrightness));

	onMount(() => {
		// Auto-flush on load if anything is pending
		setTimeout(() => banner?.sync({ silent: true }), 800);
	});

	$effect(() => installTheme(data.preferences));
</script>

<svelte:head>
	<link rel="manifest" href={manifestHref} />
	<meta name="theme-color" content={headTheme.canvas} />
	<meta
		name="apple-mobile-web-app-status-bar-style"
		content={headBrightness === 'dark' ? 'black-translucent' : 'default'}
	/>
</svelte:head>

<OfflineBanner />
<PendingVisitsBanner bind:this={banner} />

<main class="mx-auto flex min-h-dvh max-w-3xl flex-col">
	{@render children()}
	<QuickAdd />
	<BottomNav inboxCount={data.inboxCount} />
</main>

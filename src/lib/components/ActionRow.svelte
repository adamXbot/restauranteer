<script lang="ts">
	import { navigationUrl, labelForApp, type NavigationApp } from '$lib/navigation';

	export type EnrichField = 'phone' | 'website' | 'address' | 'location';

	type Props = {
		phone: string | null;
		website: string | null;
		mapsUri: string | null;
		address: string | null;
		lat?: number | null;
		lng?: number | null;
		name?: string | null;
		navigationApp: NavigationApp;
		inVault: boolean;
		onEnrich?: (field: EnrichField) => void;
		/** Drop the page-level padding when embedded in a card/rail. */
		bare?: boolean;
	};
	let { phone, website, address, lat, lng, name, navigationApp, inVault, onEnrich, bare = false }: Props = $props();

	const telHref = $derived(phone ? `tel:${phone.replace(/[^+\d]/g, '')}` : null);
	const navHref = $derived(
		navigationUrl(
			{ name: name ?? null, address: address ?? null, lat: lat ?? null, lng: lng ?? null },
			navigationApp
		)
	);
	const navLabel = $derived(labelForApp(navigationApp));
	const canEnrich = $derived(inVault && !!onEnrich);
</script>

<nav class="grid grid-cols-3 gap-2 text-xs text-secondary {bare ? '' : 'px-5 pt-4'}">
	{#if telHref}
		<a
			href={telHref}
			class="flex flex-col items-center gap-1 rounded-xl border border-line bg-panel/50 py-3"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0122 16.92z"/></svg>
			<span>Call</span>
		</a>
	{:else if canEnrich}
		<button
			type="button"
			onclick={() => onEnrich?.('phone')}
			class="flex flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong bg-panel/30 py-3 text-secondary hover:border-accent/60 hover:text-accent"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0122 16.92z"/></svg>
			<span>+ Add phone</span>
		</button>
	{:else}
		<span
			class="flex flex-col items-center gap-1 rounded-xl border border-line bg-panel/30 py-3 text-tertiary/60"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0122 16.92z"/></svg>
			<span>No phone</span>
		</span>
	{/if}
	{#if website}
		<a
			href={website}
			target="_blank"
			rel="noopener noreferrer"
			class="flex flex-col items-center gap-1 rounded-xl border border-line bg-panel/50 py-3"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
			<span>Website</span>
		</a>
	{:else if canEnrich}
		<button
			type="button"
			onclick={() => onEnrich?.('website')}
			class="flex flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong bg-panel/30 py-3 text-secondary hover:border-accent/60 hover:text-accent"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
			<span>+ Add site</span>
		</button>
	{:else}
		<span
			class="flex flex-col items-center gap-1 rounded-xl border border-line bg-panel/30 py-3 text-tertiary/60"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
			<span>No site</span>
		</span>
	{/if}
	{#if navHref}
		<a
			href={navHref}
			target="_blank"
			rel="noopener noreferrer"
			class="flex flex-col items-center gap-1 rounded-xl border border-line bg-panel/50 py-3"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
			<span>{navLabel}</span>
		</a>
	{:else if canEnrich}
		<button
			type="button"
			onclick={() => onEnrich?.('location')}
			class="flex flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong bg-panel/30 py-3 text-secondary hover:border-accent/60 hover:text-accent"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
			<span>+ Add location</span>
		</button>
	{:else}
		<span
			class="flex flex-col items-center gap-1 rounded-xl border border-line bg-panel/30 py-3 text-tertiary/60"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
			<span>No address</span>
		</span>
	{/if}
</nav>

<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import PhotoCarousel from '$lib/components/PhotoCarousel.svelte';
	import ActionRow from '$lib/components/ActionRow.svelte';
	import ReviewList from '$lib/components/ReviewList.svelte';
	import HoursList from '$lib/components/HoursList.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import { cuisinesFromTypes } from '$lib/cuisine';

	let { data }: { data: PageData } = $props();
	let adding = $state(false);
	let error = $state<string | null>(null);

	const cuisine = $derived(cuisinesFromTypes(data.place.types));

	async function addToVault() {
		adding = true;
		error = null;
		try {
			const res = await fetch('/api/restaurants', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ google_place_id: data.place.id })
			});
			if (!res.ok) {
				error = `Failed: ${res.status}`;
				adding = false;
				return;
			}
			const json = (await res.json()) as { uuid: string };
			await goto(`/restaurant/${json.uuid}`);
		} catch (e) {
			error = String(e);
			adding = false;
		}
	}
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href="/" />
	<h1 class="mt-2 text-2xl font-semibold text-slate-50">{data.place.name}</h1>
	{#if data.place.address}
		<p class="mt-0.5 text-sm text-slate-400">{data.place.address}</p>
	{/if}
	{#if cuisine.length > 0}
		<div class="mt-2 flex flex-wrap gap-1">
			{#each cuisine as c (c)}
				<span class="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{c}</span>
			{/each}
		</div>
	{/if}
	{#if data.place.rating != null}
		<p class="mt-2 text-sm text-amber-300">
			★ {data.place.rating}
			{#if data.place.user_rating_count}<span class="text-slate-500"
					>({data.place.user_rating_count.toLocaleString()} reviews)</span
				>{/if}
		</p>
	{/if}
</header>

{#if data.place.photos.length > 0}
	<PhotoCarousel photos={data.place.photos} />
{/if}

<div class="px-5 pt-4">
	{#if data.vaultUuid}
		<a
			href={`/restaurant/${data.vaultUuid}`}
			class="block w-full rounded-2xl bg-slate-700 px-5 py-3 text-center text-sm font-medium text-slate-100"
		>
			★ Already in your vault — open
		</a>
	{:else}
		<button
			onclick={addToVault}
			disabled={adding}
			class="block w-full rounded-2xl bg-orange-600 px-5 py-3 text-center text-sm font-medium text-white disabled:opacity-50"
		>
			{adding ? 'Adding…' : '+ Add to vault'}
		</button>
		{#if error}
			<p class="mt-2 text-xs text-red-400">{error}</p>
		{/if}
	{/if}
</div>

<ActionRow
	phone={data.place.phone}
	website={data.place.website}
	mapsUri={data.place.google_maps_uri}
	address={data.place.address}
	lat={data.place.lat}
	lng={data.place.lng}
	name={data.place.name}
	navigationApp={data.preferences.default_navigation_app}
	inVault={false}
/>

{#if data.place.weekday_descriptions.length > 0}
	<section class="px-5 pt-4 pb-2">
		<h2 class="text-sm font-medium tracking-wide text-slate-400 uppercase">Hours</h2>
		<HoursList lines={data.place.weekday_descriptions} />
	</section>
{/if}

{#if data.place.reviews.length > 0}
	<section class="px-5 pt-4 pb-10">
		<h2 class="text-sm font-medium tracking-wide text-slate-400 uppercase">Google reviews</h2>
		<ReviewList reviews={data.place.reviews} />
	</section>
{/if}

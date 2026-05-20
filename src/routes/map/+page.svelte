<script lang="ts">
	/// <reference types="google.maps" />
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { loadMapKit } from '$lib/appleMapKit';
	import { loadGoogleMaps, GOOGLE_DARK_STYLES } from '$lib/googleMaps';
	import BackLink from '$lib/components/BackLink.svelte';

	let { data }: { data: PageData } = $props();

	type Pin = {
		uuid: string;
		name: string;
		lat: number;
		lng: number;
		suburb: string | null;
		rating: number | null;
	};

	const effectiveProvider = $derived.by<'mapbox' | 'apple' | 'google'>(() => {
		const want = data.preferences.default_map_provider;
		if (want === 'apple' && data.appleAvailable) return 'apple';
		if (want === 'google' && data.googleMapsKey) return 'google';
		return 'mapbox';
	});

	let mapEl: HTMLDivElement | null = $state(null);
	let selected = $state<Pin | null>(null);
	let loading = $state(true);
	let mapError = $state<string | null>(null);

	async function fetchPins(): Promise<Pin[]> {
		const res = await fetch('/api/map');
		if (!res.ok) throw new Error(`Failed to load pins: ${res.status}`);
		const data = (await res.json()) as { pins: Pin[] };
		return data.pins;
	}

	onMount(() => {
		let cleanup: () => void = () => {};
		let cancelled = false;

		(async () => {
			try {
				const pins = await fetchPins();
				if (cancelled || !mapEl) return;

				if (effectiveProvider === 'apple') {
					const mapkit = await loadMapKit();
					if (cancelled || !mapEl) return;
					const center =
						pins.length > 0
							? new mapkit.Coordinate(pins[0].lat, pins[0].lng)
							: new mapkit.Coordinate(-37.8136, 144.9631);
					const map = new mapkit.Map(mapEl, {
						center,
						cameraDistance: 8000,
						showsCompass: mapkit.FeatureVisibility.Hidden,
						showsScale: mapkit.FeatureVisibility.Hidden,
						colorScheme: mapkit.Map.ColorSchemes.Dark
					});
					for (const pin of pins) {
						const annotation = new mapkit.MarkerAnnotation(
							new mapkit.Coordinate(pin.lat, pin.lng),
							{
								color: '#e6794a',
								glyphText: pin.rating != null ? String(pin.rating) : '★',
								title: pin.name,
								selected: false
							}
						);
						annotation.addEventListener('select', () => {
							selected = pin;
						});
						map.addAnnotation(annotation);
					}
					if (pins.length > 1) {
						const region = map.regionThatFits(
							pins.map((p) => new mapkit.Coordinate(p.lat, p.lng))
						);
						if (region) map.region = region;
					}
					loading = false;
					cleanup = () => map.destroy?.();
				} else if (effectiveProvider === 'google') {
					if (!data.googleMapsKey) {
						mapError = 'Set GOOGLE_MAPS_PUBLIC_KEY in .env to enable Google Maps.';
						loading = false;
						return;
					}
					const google = await loadGoogleMaps(data.googleMapsKey);
					if (cancelled || !mapEl) return;
					const center =
						pins.length > 0
							? { lat: pins[0].lat, lng: pins[0].lng }
							: { lat: -37.8136, lng: 144.9631 };
					const map = new google.maps.Map(mapEl, {
						center,
						zoom: pins.length > 0 ? 12 : 10,
						disableDefaultUI: false,
						mapTypeControl: false,
						streetViewControl: false,
						fullscreenControl: false,
						styles: GOOGLE_DARK_STYLES
					});
					const markers: google.maps.Marker[] = [];
					for (const pin of pins) {
						const marker = new google.maps.Marker({
							position: { lat: pin.lat, lng: pin.lng },
							map,
							title: pin.name,
							label: {
								text: pin.rating != null ? String(pin.rating) : '★',
								color: '#ffffff',
								fontSize: '12px',
								fontWeight: '600'
							},
							icon: {
								path: google.maps.SymbolPath.CIRCLE,
								scale: 14,
								fillColor: '#e6794a',
								fillOpacity: 1,
								strokeColor: '#f1f5f9',
								strokeWeight: 2
							}
						});
						marker.addListener('click', () => {
							selected = pin;
						});
						markers.push(marker);
					}
					if (pins.length > 1) {
						const bounds = new google.maps.LatLngBounds();
						for (const p of pins) bounds.extend({ lat: p.lat, lng: p.lng });
						map.fitBounds(bounds, 60);
					}
					loading = false;
					cleanup = () => {
						for (const m of markers) m.setMap(null);
					};
				} else {
					if (!data.mapboxToken) {
						mapError = 'Set MAPBOX_PUBLIC_TOKEN in .env to enable the map.';
						loading = false;
						return;
					}
					const mapboxgl = (await import('mapbox-gl')).default;
					await import('mapbox-gl/dist/mapbox-gl.css');
					if (cancelled || !mapEl) return;
					mapboxgl.accessToken = data.mapboxToken;

					const center: [number, number] =
						pins.length > 0 ? [pins[0].lng, pins[0].lat] : [144.9631, -37.8136];
					const map = new mapboxgl.Map({
						container: mapEl,
						style: 'mapbox://styles/mapbox/dark-v11',
						center,
						zoom: pins.length > 0 ? 12 : 10
					});
					map.on('load', () => {
						loading = false;
						for (const pin of pins) {
							const el = document.createElement('button');
							el.type = 'button';
							el.className =
								'flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-2 border-slate-100 bg-orange-600 text-xs text-white shadow';
							el.textContent = pin.rating != null ? String(pin.rating) : '★';
							el.setAttribute('aria-label', pin.name);
							el.addEventListener('click', () => {
								selected = pin;
							});
							new mapboxgl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map);
						}
						if (pins.length > 1) {
							const bounds = pins.reduce(
								(b, p) => b.extend([p.lng, p.lat] as [number, number]),
								new mapboxgl.LngLatBounds([pins[0].lng, pins[0].lat], [pins[0].lng, pins[0].lat])
							);
							map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
						}
					});
					map.on('error', (e) => {
						const err = (e as { error?: { message?: string } }).error;
						mapError = err?.message ?? 'map error';
					});
					cleanup = () => map.remove();
				}
			} catch (e) {
				mapError = String(e);
				loading = false;
			}
		})();

		return () => {
			cancelled = true;
			cleanup();
		};
	});

	function open(pin: Pin) {
		goto(`/restaurant/${pin.uuid}`);
	}
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href="/" />
	<h1 class="mt-2 text-2xl font-semibold text-slate-50">Map</h1>
</header>

{#if mapError}
	<div class="mx-5 mt-3 rounded-2xl border border-amber-900 bg-amber-950/40 p-4 text-sm text-amber-200">
		{mapError}
	</div>
{/if}

<div class="relative mt-3 h-[calc(100dvh-12rem)] w-full bg-slate-900">
	<div bind:this={mapEl} class="absolute inset-0"></div>
	{#if loading}
		<div class="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
			Loading map…
		</div>
	{/if}
</div>

{#if selected}
	<button
		type="button"
		class="fixed inset-0 z-10 bg-transparent"
		aria-label="Dismiss"
		onclick={() => (selected = null)}
	></button>
	<div
		class="fixed inset-x-0 bottom-0 z-20 rounded-t-3xl border-t border-slate-800 bg-slate-900 p-5 pb-8 shadow-xl"
	>
		<h2 class="text-base font-medium text-slate-100">{selected.name}</h2>
		{#if selected.suburb}
			<p class="text-xs text-slate-400">{selected.suburb}</p>
		{/if}
		{#if selected.rating != null}
			<p class="mt-1 text-sm text-amber-300">★ {selected.rating}</p>
		{/if}
		<button
			type="button"
			onclick={() => open(selected!)}
			class="mt-3 w-full rounded-2xl bg-orange-600 px-5 py-3 text-sm font-medium text-white"
		>
			Open
		</button>
	</div>
{/if}

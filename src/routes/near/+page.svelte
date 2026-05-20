<script lang="ts">
	/// <reference types="google.maps" />
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { formatDistance } from '$lib/geo';
	import CuisinePicker from '$lib/components/CuisinePicker.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import { loadMapKit } from '$lib/appleMapKit';
	import { loadGoogleMaps, GOOGLE_DARK_STYLES } from '$lib/googleMaps';

	let { data }: { data: PageData } = $props();

	type VaultResult = {
		source: 'vault';
		uuid: string;
		name: string;
		address: string | null;
		suburb: string | null;
		lat: number;
		lng: number;
		distance_m: number;
		rating: number | null;
		cuisine: string[];
		tags: string[];
		lists: string[];
	};
	type GoogleResult = {
		source: 'google';
		place_id: string;
		name: string;
		address: string | null;
		lat: number;
		lng: number;
		distance_m: number;
		rating: number | null;
		user_rating_count: number | null;
		cuisine: string[];
		price_level: number | null;
		photo_name: string | null;
	};
	type Result = VaultResult | GoogleResult;

	const RADII = [500, 1000, 2000, 5000, 10000];
	const RATINGS = [0, 3, 4, 4.5];
	const DEFAULT_CENTER: [number, number] = [144.9631, -37.8136]; // Melbourne CBD

	let center = $state<{ lat: number; lng: number } | null>(null);
	let radiusIdx = $state(2); // 2000m
	let ratingIdx = $state(0); // any
	let cuisines = $state<string[]>([]);
	// svelte-ignore state_referenced_locally
	let source = $state<'all' | 'vault'>(data.googleEnabled ? 'all' : 'vault');
	let pickingCuisine = $state(false);

	const effectiveProvider = $derived.by<'mapbox' | 'apple' | 'google'>(() => {
		const want = data.preferences.default_map_provider;
		if (want === 'apple' && data.appleAvailable) return 'apple';
		if (want === 'google' && data.googleMapsKey) return 'google';
		return 'mapbox';
	});

	let mapEl = $state<HTMLDivElement | null>(null);
	// Provider-agnostic refs (any-typed because the two SDKs have very different APIs)
	let mapRef: any = null;
	let centerMarker: any = null;
	let resultMarkers: any[] = [];
	let geoErr = $state<string | null>(null);

	let results = $state<Result[]>([]);
	let loading = $state(false);
	let queryErr = $state<string | null>(null);
	// svelte-ignore state_referenced_locally
	let googleEnabledServerSide = $state(data.googleEnabled);

	const radius = $derived(RADII[radiusIdx]);
	const minRating = $derived(RATINGS[ratingIdx]);

	function cycleRadius() {
		radiusIdx = (radiusIdx + 1) % RADII.length;
	}
	function cycleRating() {
		ratingIdx = (ratingIdx + 1) % RATINGS.length;
	}
	function toggleSource() {
		if (!data.googleEnabled) return;
		source = source === 'all' ? 'vault' : 'all';
	}

	function useMyLocation() {
		if (!navigator.geolocation) {
			geoErr = 'Geolocation not supported';
			return;
		}
		geoErr = null;
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				center = { lat: pos.coords.latitude, lng: pos.coords.longitude };
				panMap();
			},
			(err) => {
				geoErr = err.message || 'Location denied';
			},
			{ enableHighAccuracy: true, timeout: 8000 }
		);
	}

	async function loadMap() {
		if (!mapEl) return;
		if (effectiveProvider === 'apple') {
			const mapkit = await loadMapKit();
			if (!mapEl) return;
			const startCenter = center
				? new mapkit.Coordinate(center.lat, center.lng)
				: new mapkit.Coordinate(DEFAULT_CENTER[1], DEFAULT_CENTER[0]);
			mapRef = new mapkit.Map(mapEl, {
				center: startCenter,
				cameraDistance: 4000,
				showsCompass: mapkit.FeatureVisibility.Hidden,
				showsScale: mapkit.FeatureVisibility.Hidden,
				colorScheme: mapkit.Map.ColorSchemes.Dark
			});
			// Note: Apple MapKit JS doesn't surface a clean "tap empty map" lat/lng.
			// On Apple mode, dropping a pin via tap is unavailable — use the
			// "Use my location" button instead.
			return;
		}
		if (effectiveProvider === 'google') {
			if (!data.googleMapsKey) return;
			const google = await loadGoogleMaps(data.googleMapsKey);
			if (!mapEl) return;
			mapRef = new google.maps.Map(mapEl, {
				center: center ? { lat: center.lat, lng: center.lng } : { lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] },
				zoom: 13,
				disableDefaultUI: false,
				mapTypeControl: false,
				streetViewControl: false,
				fullscreenControl: false,
				styles: GOOGLE_DARK_STYLES
			});
			mapRef.addListener('click', (e: google.maps.MapMouseEvent) => {
				if (e.latLng) center = { lat: e.latLng.lat(), lng: e.latLng.lng() };
			});
			return;
		}
		if (!data.mapboxToken) return;
		const mapboxgl = (await import('mapbox-gl')).default;
		await import('mapbox-gl/dist/mapbox-gl.css');
		mapboxgl.accessToken = data.mapboxToken;
		mapRef = new mapboxgl.Map({
			container: mapEl,
			style: 'mapbox://styles/mapbox/dark-v11',
			center: center ? [center.lng, center.lat] : DEFAULT_CENTER,
			zoom: 13
		});
		mapRef.on('click', (e: { lngLat: { lat: number; lng: number } }) => {
			center = { lat: e.lngLat.lat, lng: e.lngLat.lng };
		});
	}

	function panMap() {
		if (!mapRef || !center) return;
		if (effectiveProvider === 'apple') {
			mapRef.region = new window.mapkit.CoordinateRegion(
				new window.mapkit.Coordinate(center.lat, center.lng),
				new window.mapkit.CoordinateSpan(0.02, 0.02)
			);
			return;
		}
		if (effectiveProvider === 'google') {
			mapRef.panTo({ lat: center.lat, lng: center.lng });
			mapRef.setZoom(14);
			return;
		}
		mapRef.flyTo({ center: [center.lng, center.lat], zoom: 14, duration: 600 });
	}

	function drawCenter() {
		if (!mapRef || !center) return;
		if (effectiveProvider === 'apple') {
			if (centerMarker) mapRef.removeAnnotation(centerMarker);
			const ann = new window.mapkit.MarkerAnnotation(
				new window.mapkit.Coordinate(center.lat, center.lng),
				{ color: '#e6794a', glyphText: '●', title: 'Here', selected: false }
			);
			mapRef.addAnnotation(ann);
			centerMarker = ann;
			return;
		}
		if (effectiveProvider === 'google') {
			if (centerMarker) centerMarker.setMap(null);
			centerMarker = new window.google.maps.Marker({
				position: { lat: center.lat, lng: center.lng },
				map: mapRef,
				icon: {
					path: window.google.maps.SymbolPath.CIRCLE,
					scale: 8,
					fillColor: '#f97316',
					fillOpacity: 1,
					strokeColor: '#ffffff',
					strokeWeight: 2
				},
				title: 'Here'
			});
			return;
		}
		import('mapbox-gl').then(({ default: mapboxgl }) => {
			if (centerMarker) centerMarker.remove();
			const el = document.createElement('div');
			el.className =
				'h-4 w-4 rounded-full border-2 border-white bg-orange-500 shadow ring-4 ring-orange-500/30';
			centerMarker = new mapboxgl.Marker({ element: el })
				.setLngLat([center!.lng, center!.lat])
				.addTo(mapRef!);
		});
	}

	function drawResultMarkers() {
		if (!mapRef) return;
		if (effectiveProvider === 'apple') {
			for (const m of resultMarkers) mapRef.removeAnnotation(m);
			resultMarkers = [];
			for (const r of results) {
				const ann = new window.mapkit.MarkerAnnotation(
					new window.mapkit.Coordinate(r.lat, r.lng),
					{
						color: r.source === 'vault' ? '#e6794a' : '#475569',
						glyphText: r.source === 'vault' ? '★' : '•',
						title: r.name,
						selected: false
					}
				);
				ann.addEventListener('select', () => openResult(r));
				mapRef.addAnnotation(ann);
				resultMarkers.push(ann);
			}
			return;
		}
		if (effectiveProvider === 'google') {
			for (const m of resultMarkers) m.setMap(null);
			resultMarkers = [];
			for (const r of results) {
				const marker = new window.google.maps.Marker({
					position: { lat: r.lat, lng: r.lng },
					map: mapRef,
					title: r.name,
					label: {
						text: r.source === 'vault' ? '★' : '•',
						color: '#ffffff',
						fontSize: '10px',
						fontWeight: '700'
					},
					icon: {
						path: window.google.maps.SymbolPath.CIRCLE,
						scale: r.source === 'vault' ? 12 : 9,
						fillColor: r.source === 'vault' ? '#e6794a' : '#475569',
						fillOpacity: 1,
						strokeColor: r.source === 'vault' ? '#f1f5f9' : '#cbd5e1',
						strokeWeight: r.source === 'vault' ? 2 : 1
					}
				});
				marker.addListener('click', () => openResult(r));
				resultMarkers.push(marker);
			}
			return;
		}
		import('mapbox-gl').then(({ default: mapboxgl }) => {
			for (const m of resultMarkers) m.remove();
			resultMarkers = [];
			for (const r of results) {
				const el = document.createElement('button');
				el.type = 'button';
				el.className =
					r.source === 'vault'
						? 'flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-slate-100 bg-orange-600 text-[10px] text-white shadow'
						: 'flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-slate-700 text-[9px] text-slate-100';
				el.textContent = r.source === 'vault' ? '★' : '•';
				el.title = r.name;
				el.addEventListener('click', () => openResult(r));
				const marker = new mapboxgl.Marker({ element: el })
					.setLngLat([r.lng, r.lat])
					.addTo(mapRef!);
				resultMarkers.push(marker);
			}
		});
	}

	function openResult(r: Result) {
		if (r.source === 'vault') void goto(`/restaurant/${r.uuid}`);
		else void goto(`/place/${r.place_id}`);
	}

	async function runQuery() {
		if (!center) return;
		loading = true;
		queryErr = null;
		try {
			const params = new URLSearchParams({
				lat: String(center.lat),
				lng: String(center.lng),
				radius: String(radius),
				source
			});
			if (minRating > 0) params.set('min_rating', String(minRating));
			if (cuisines.length > 0) params.set('cuisines', cuisines.join(','));
			const res = await fetch(`/api/near?${params.toString()}`);
			if (!res.ok) {
				queryErr = `Query failed: ${res.status}`;
				return;
			}
			const data = (await res.json()) as {
				results: Result[];
				google_enabled: boolean;
			};
			results = data.results;
			googleEnabledServerSide = data.google_enabled;
		} catch (e) {
			queryErr = String(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void loadMap();
		return () => {
			try {
				if (effectiveProvider === 'apple') {
					for (const m of resultMarkers) mapRef?.removeAnnotation?.(m);
					if (centerMarker) mapRef?.removeAnnotation?.(centerMarker);
					mapRef?.destroy?.();
				} else if (effectiveProvider === 'google') {
					for (const m of resultMarkers) m.setMap?.(null);
					centerMarker?.setMap?.(null);
				} else {
					for (const m of resultMarkers) m.remove?.();
					centerMarker?.remove?.();
					mapRef?.remove?.();
				}
			} catch {
				/* ignore */
			}
		};
	});

	$effect(() => {
		if (center) {
			drawCenter();
			void runQuery();
		}
	});
	$effect(() => {
		drawResultMarkers();
	});
	$effect(() => {
		// re-run when filters change (if center known)
		void radius;
		void minRating;
		void cuisines;
		void source;
		if (center) void runQuery();
	});
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href="/" />
	<h1 class="mt-2 text-2xl font-semibold text-slate-50">Near me</h1>
	<p class="mt-1 text-sm text-slate-400">
		Pinpoint a spot and find a place worth trying.
	</p>
</header>

<div class="relative mt-3 h-[40vh] w-full bg-slate-900">
	<div bind:this={mapEl} class="absolute inset-0"></div>
	{#if effectiveProvider === 'mapbox' && !data.mapboxToken}
		<div class="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-slate-400">
			Set MAPBOX_PUBLIC_TOKEN in .env to enable the map. You can still filter results below.
		</div>
	{:else if effectiveProvider === 'google' && !data.googleMapsKey}
		<div class="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-slate-400">
			Set GOOGLE_MAPS_PUBLIC_KEY in .env to enable the map. You can still filter results below.
		</div>
	{:else if !center}
		<div class="absolute inset-x-0 bottom-2 text-center text-[11px] text-slate-300">
			{#if effectiveProvider === 'apple'}
				Use the "Use my location" button below to pin a search point.
			{:else}
				Tap anywhere on the map to drop a pin, or use the button below.
			{/if}
		</div>
	{/if}
</div>

<div class="flex flex-wrap items-center gap-2 px-5 pt-3">
	<button
		type="button"
		onclick={useMyLocation}
		class="rounded-full bg-orange-600 px-3 py-1.5 text-xs font-medium text-white"
	>
		📍 Use my location
	</button>
	<button
		type="button"
		onclick={cycleRadius}
		class="rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
	>
		{radius >= 1000 ? `${radius / 1000}km` : `${radius}m`}
	</button>
	<button
		type="button"
		onclick={cycleRating}
		class="rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
	>
		{minRating > 0 ? `★ ${minRating}+` : 'Any ★'}
	</button>
	<button
		type="button"
		onclick={() => (pickingCuisine = true)}
		class="rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
	>
		{cuisines.length === 0 ? 'Cuisine: any' : `Cuisine: ${cuisines.length}`}
	</button>
	{#if data.googleEnabled}
		<button
			type="button"
			onclick={toggleSource}
			class="rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs"
			class:text-emerald-300={source === 'all'}
			class:text-slate-400={source === 'vault'}
		>
			{source === 'all' ? 'Vault + Google' : 'Vault only'}
		</button>
	{/if}
</div>
{#if geoErr}
	<p class="px-5 pt-1 text-[11px] text-amber-400">{geoErr}</p>
{/if}
{#if queryErr}
	<p class="px-5 pt-1 text-[11px] text-red-400">{queryErr}</p>
{/if}

<section class="px-5 pt-4 pb-6">
	{#if !center}
		<p class="text-sm text-slate-500">Pinpoint a spot to see what's nearby.</p>
	{:else if loading && results.length === 0}
		<p class="text-sm text-slate-500">Searching…</p>
	{:else if results.length === 0}
		<p class="text-sm text-slate-500">
			Nothing within {radius >= 1000 ? `${radius / 1000}km` : `${radius}m`} matches.
			{#if minRating > 0}Try lowering the rating threshold.{/if}
			{#if cuisines.length > 0}Try clearing cuisine filters.{/if}
		</p>
	{:else}
		<ul class="space-y-2">
			{#each results as r (r.source === 'vault' ? r.uuid : r.place_id)}
				<li>
					<button
						type="button"
						onclick={() => openResult(r)}
						class="block w-full min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-3 text-left"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									{#if r.source === 'vault'}
										<span class="text-[10px] tracking-widest text-orange-400 uppercase"
											>★ Vault</span
										>
									{:else}
										<span class="text-[10px] tracking-widest text-slate-500 uppercase"
											>Google</span
										>
									{/if}
									<span class="text-[10px] text-slate-500">{formatDistance(r.distance_m)}</span>
								</div>
								<h3 class="mt-0.5 truncate text-sm font-medium text-slate-100">{r.name}</h3>
								{#if r.source === 'vault' && (r.suburb || r.address)}
									<p class="truncate text-xs text-slate-400">{r.suburb ?? r.address}</p>
								{:else if r.source === 'google' && r.address}
									<p class="truncate text-xs text-slate-400">{r.address}</p>
								{/if}
								{#if r.cuisine.length > 0}
									<div class="mt-1.5 flex flex-wrap gap-1">
										{#each r.cuisine.slice(0, 4) as c (c)}
											<span class="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300"
												>{c}</span
											>
										{/each}
									</div>
								{/if}
							</div>
							{#if r.rating != null}
								<span class="shrink-0 text-xs text-amber-300">★ {r.rating}</span>
							{/if}
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if pickingCuisine}
	<CuisinePicker
		all={data.cuisines}
		selected={cuisines}
		onApply={(next) => {
			cuisines = next;
			pickingCuisine = false;
		}}
		onClose={() => (pickingCuisine = false)}
	/>
{/if}

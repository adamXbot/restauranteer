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
	import { navigationUrl, labelForApp } from '$lib/navigation';

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
	type VaultPin = {
		uuid: string;
		name: string;
		lat: number;
		lng: number;
		suburb: string | null;
		address: string | null;
		rating: number | null;
		cuisine: string[];
	};
	type Result = VaultResult | GoogleResult;
	type SelectedPin = (VaultPin & { source: 'vault'; distance_m?: number }) | GoogleResult;
	type MapTheme = {
		brightness: 'light' | 'dark';
		accent: string;
		onAccent: string;
		text: string;
		mapSecondary: string;
	};

	const RADII = [500, 1000, 2000, 5000, 10000];
	const RATINGS = [0, 3, 4, 4.5];
	const DEFAULT_CENTER: [number, number] = [144.9631, -37.8136]; // Melbourne CBD

	let center = $state<{ lat: number; lng: number } | null>(null);
	let radiusIdx = $state(2); // 2000m
	let ratingIdx = $state(0); // any
	let cuisines = $state<string[]>([]);
	let pickingCuisine = $state(false);

	const effectiveProvider = $derived.by<'mapbox' | 'apple' | 'google'>(() => {
		const want = data.preferences.default_map_provider;
		if (want === 'apple' && data.appleAvailable) return 'apple';
		if (want === 'google' && data.googleMapsKey) return 'google';
		return 'mapbox';
	});

	function readMapTheme(): MapTheme {
		const root = document.documentElement;
		const styles = getComputedStyle(root);
		const css = (name: string, fallback: string) =>
			styles.getPropertyValue(name).trim() || fallback;
		return {
			brightness: root.dataset.brightness === 'light' ? 'light' : 'dark',
			accent: css('--theme-accent', '#e6794a'),
			onAccent: css('--theme-on-accent', '#000000'),
			text: css('--theme-text', '#f8fafc'),
			mapSecondary: css('--theme-map-secondary', '#64748b')
		};
	}

	function mapboxStyle(theme: MapTheme): string {
		return `mapbox://styles/mapbox/${theme.brightness === 'dark' ? 'dark' : 'light'}-v11`;
	}

	let mapEl = $state<HTMLDivElement | null>(null);
	// Provider-agnostic refs (any-typed because the two SDKs have very different APIs)
	let mapRef: any = null;
	let centerMarker: any = null;
	let vaultMarkers: any[] = [];
	let googleMarkers: any[] = [];
	let fittedVaultPins = false;
	let geoErr = $state<string | null>(null);

	let vaultPins = $state<VaultPin[]>([]);
	let vaultPinsLoading = $state(false);
	let vaultPinsErr = $state<string | null>(null);
	let results = $state<Result[]>([]);
	let selectedPin = $state<SelectedPin | null>(null);
	let loading = $state(false);
	let queryErr = $state<string | null>(null);

	const radius = $derived(RADII[radiusIdx]);
	const minRating = $derived(RATINGS[ratingIdx]);

	// Apply cuisine + min-rating filters to the no-center vault list. The
	// `/api/near` results path already filters by all three (including radius)
	// once a center pin is dropped.
	const filteredVaultPins = $derived.by(() => {
		const cuisinesLc = cuisines.map((c) => c.toLowerCase());
		return [...vaultPins]
			.filter((p) => {
				if (minRating > 0 && (p.rating ?? 0) < minRating) return false;
				if (cuisinesLc.length > 0) {
					const have = p.cuisine.map((c) => c.toLowerCase());
					if (!have.some((c) => cuisinesLc.includes(c))) return false;
				}
				return true;
			})
			.sort((a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
			);
	});
	const filtersActive = $derived(minRating > 0 || cuisines.length > 0);
	const selectedNavHref = $derived(
		selectedPin
			? navigationUrl(
					{
						name: selectedPin.name,
						address: selectedPin.source === 'google' ? selectedPin.address : selectedPin.address,
						lat: selectedPin.lat,
						lng: selectedPin.lng
					},
					data.preferences.default_navigation_app
				)
			: null
	);
	const navLabel = $derived(labelForApp(data.preferences.default_navigation_app));

	function cycleRadius() {
		radiusIdx = (radiusIdx + 1) % RADII.length;
	}
	function cycleRating() {
		ratingIdx = (ratingIdx + 1) % RATINGS.length;
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
		const theme = readMapTheme();
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
				colorScheme:
					theme.brightness === 'dark'
						? mapkit.Map.ColorSchemes.Dark
						: mapkit.Map.ColorSchemes.Light
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
				styles: theme.brightness === 'dark' ? GOOGLE_DARK_STYLES : []
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
			style: mapboxStyle(theme),
			center: center ? [center.lng, center.lat] : DEFAULT_CENTER,
			zoom: 13
		});
		mapRef.on('click', (e: { lngLat: { lat: number; lng: number } }) => {
			center = { lat: e.lngLat.lat, lng: e.lngLat.lng };
		});
		await new Promise<void>((resolve) => {
			const done = () => resolve();
			mapRef.once('load', done);
			mapRef.once('error', done);
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

	async function loadVaultPins() {
		vaultPinsLoading = true;
		vaultPinsErr = null;
		try {
			const res = await fetch('/api/map');
			if (!res.ok) throw new Error(`Saved pins failed: ${res.status}`);
			const data = (await res.json()) as { pins: VaultPin[] };
			vaultPins = data.pins;
			fittedVaultPins = false;
		} catch (e) {
			vaultPinsErr = String(e);
		} finally {
			vaultPinsLoading = false;
		}
	}

	function fitVaultPins() {
		if (!mapRef || center || fittedVaultPins || vaultPins.length === 0) return;
		fittedVaultPins = true;
		if (effectiveProvider === 'apple') {
			if (vaultPins.length === 1) {
				const pin = vaultPins[0];
				mapRef.region = new window.mapkit.CoordinateRegion(
					new window.mapkit.Coordinate(pin.lat, pin.lng),
					new window.mapkit.CoordinateSpan(0.04, 0.04)
				);
				return;
			}
			const region = mapRef.regionThatFits(
				vaultPins.map((p) => new window.mapkit.Coordinate(p.lat, p.lng))
			);
			if (region) mapRef.region = region;
			return;
		}
		if (effectiveProvider === 'google') {
			if (vaultPins.length === 1) {
				const pin = vaultPins[0];
				mapRef.setCenter({ lat: pin.lat, lng: pin.lng });
				mapRef.setZoom(12);
				return;
			}
			const bounds = new window.google.maps.LatLngBounds();
			for (const p of vaultPins) bounds.extend({ lat: p.lat, lng: p.lng });
			mapRef.fitBounds(bounds, 60);
			return;
		}
		void import('mapbox-gl').then(({ default: mapboxgl }) => {
			if (!mapRef || center || vaultPins.length === 0) return;
			if (vaultPins.length === 1) {
				const pin = vaultPins[0];
				mapRef.flyTo({ center: [pin.lng, pin.lat], zoom: 12, duration: 0 });
				return;
			}
			const first = vaultPins[0];
			const bounds = vaultPins.reduce(
				(b, p) => b.extend([p.lng, p.lat] as [number, number]),
				new mapboxgl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat])
			);
			mapRef.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
		});
	}

	function drawCenter() {
		if (!mapRef || !center) return;
		const theme = readMapTheme();
		if (effectiveProvider === 'apple') {
			if (centerMarker) mapRef.removeAnnotation(centerMarker);
			const ann = new window.mapkit.MarkerAnnotation(
				new window.mapkit.Coordinate(center.lat, center.lng),
				{ color: theme.accent, glyphText: '●', title: 'Here', selected: false }
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
					fillColor: theme.accent,
					fillOpacity: 1,
					strokeColor: theme.text,
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
				'h-4 w-4 rounded-full border-2 border-white bg-accent shadow ring-4 ring-accent-ring/30';
			centerMarker = new mapboxgl.Marker({ element: el })
				.setLngLat([center!.lng, center!.lat])
				.addTo(mapRef!);
		});
	}

	function drawResultMarkers() {
		if (!mapRef) return;
		const theme = readMapTheme();
		if (effectiveProvider === 'apple') {
			for (const m of vaultMarkers) mapRef.removeAnnotation(m);
			for (const m of googleMarkers) mapRef.removeAnnotation(m);
			vaultMarkers = [];
			googleMarkers = [];
			for (const pin of filteredVaultPins) {
				const ann = new window.mapkit.MarkerAnnotation(
					new window.mapkit.Coordinate(pin.lat, pin.lng),
					{
						color: theme.accent,
						glyphText: '★',
						title: pin.name,
						selected: false
					}
				);
				ann.addEventListener('select', () => selectVaultPin(pin));
				mapRef.addAnnotation(ann);
				vaultMarkers.push(ann);
			}
			for (const r of results) {
				if (r.source !== 'google') continue;
				const ann = new window.mapkit.MarkerAnnotation(
					new window.mapkit.Coordinate(r.lat, r.lng),
					{
						color: theme.mapSecondary,
						glyphText: '•',
						title: r.name,
						selected: false
					}
				);
				ann.addEventListener('select', () => selectResult(r));
				mapRef.addAnnotation(ann);
				googleMarkers.push(ann);
			}
			return;
		}
		if (effectiveProvider === 'google') {
			for (const m of vaultMarkers) m.setMap(null);
			for (const m of googleMarkers) m.setMap(null);
			vaultMarkers = [];
			googleMarkers = [];
			for (const pin of filteredVaultPins) {
				const marker = new window.google.maps.Marker({
					position: { lat: pin.lat, lng: pin.lng },
					map: mapRef,
					title: pin.name,
					label: {
						text: '★',
						color: theme.onAccent,
						fontSize: '10px',
						fontWeight: '700'
					},
					icon: {
						path: window.google.maps.SymbolPath.CIRCLE,
						scale: 12,
						fillColor: theme.accent,
						fillOpacity: 1,
						strokeColor: theme.text,
						strokeWeight: 2
					}
				});
				marker.addListener('click', () => selectVaultPin(pin));
				vaultMarkers.push(marker);
			}
			for (const r of results) {
				if (r.source !== 'google') continue;
				const marker = new window.google.maps.Marker({
					position: { lat: r.lat, lng: r.lng },
					map: mapRef,
					title: r.name,
					label: {
						text: '•',
						color: theme.text,
						fontSize: '10px',
						fontWeight: '700'
					},
					icon: {
						path: window.google.maps.SymbolPath.CIRCLE,
						scale: 9,
						fillColor: theme.mapSecondary,
						fillOpacity: 1,
						strokeColor: theme.text,
						strokeWeight: 1
					}
				});
				marker.addListener('click', () => selectResult(r));
				googleMarkers.push(marker);
			}
			return;
		}
		import('mapbox-gl').then(({ default: mapboxgl }) => {
			for (const m of vaultMarkers) m.remove();
			for (const m of googleMarkers) m.remove();
			vaultMarkers = [];
			googleMarkers = [];
			for (const pin of filteredVaultPins) {
				const el = document.createElement('button');
				el.type = 'button';
				el.className =
					'flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-primary bg-accent text-[10px] text-on-accent shadow';
				el.textContent = '★';
				el.title = pin.name;
				el.setAttribute('aria-label', `Open ${pin.name}`);
				el.addEventListener('click', (event) => {
					event.stopPropagation();
					selectVaultPin(pin);
				});
				const marker = new mapboxgl.Marker({ element: el })
					.setLngLat([pin.lng, pin.lat])
					.addTo(mapRef!);
				vaultMarkers.push(marker);
			}
			for (const r of results) {
				if (r.source !== 'google') continue;
				const el = document.createElement('button');
				el.type = 'button';
				el.className =
					'flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-secondary bg-map-secondary text-[9px] text-primary';
				el.textContent = '•';
				el.title = r.name;
				el.setAttribute('aria-label', `Open ${r.name}`);
				el.addEventListener('click', (event) => {
					event.stopPropagation();
					selectResult(r);
				});
				const marker = new mapboxgl.Marker({ element: el })
					.setLngLat([r.lng, r.lat])
					.addTo(mapRef!);
				googleMarkers.push(marker);
			}
		});
	}

	function openResult(r: Result) {
		if (r.source === 'vault') void goto(`/restaurant/${r.uuid}`);
		else void goto(`/place/${r.place_id}`);
	}

	function openVaultPin(pin: VaultPin) {
		void goto(`/restaurant/${pin.uuid}`);
	}

	function selectVaultPin(pin: VaultPin) {
		selectedPin = { ...pin, source: 'vault' };
	}

	function selectResult(r: Result) {
		selectedPin = r;
	}

	function openSelected() {
		if (!selectedPin) return;
		if (selectedPin.source === 'vault') void goto(`/restaurant/${selectedPin.uuid}`);
		else void goto(`/place/${selectedPin.place_id}`);
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
				source: data.googleEnabled ? 'all' : 'vault'
			});
			if (minRating > 0) params.set('min_rating', String(minRating));
			if (cuisines.length > 0) params.set('cuisines', cuisines.join(','));
			const res = await fetch(`/api/near?${params.toString()}`);
			if (!res.ok) {
				queryErr = `Query failed: ${res.status}`;
				return;
			}
			const payload = (await res.json()) as {
				results: Result[];
			};
			results = payload.results;
		} catch (e) {
			queryErr = String(e);
		} finally {
			loading = false;
		}
	}

	function destroyMap() {
		try {
			if (effectiveProvider === 'apple') {
				for (const m of vaultMarkers) mapRef?.removeAnnotation?.(m);
				for (const m of googleMarkers) mapRef?.removeAnnotation?.(m);
				if (centerMarker) mapRef?.removeAnnotation?.(centerMarker);
				mapRef?.destroy?.();
			} else if (effectiveProvider === 'google') {
				for (const m of vaultMarkers) m.setMap?.(null);
				for (const m of googleMarkers) m.setMap?.(null);
				centerMarker?.setMap?.(null);
			} else {
				for (const m of vaultMarkers) m.remove?.();
				for (const m of googleMarkers) m.remove?.();
				centerMarker?.remove?.();
				mapRef?.remove?.();
			}
		} catch {
			/* ignore */
		}
		mapRef = null;
		centerMarker = null;
		vaultMarkers = [];
		googleMarkers = [];
	}

	async function reloadMapForTheme() {
		destroyMap();
		mapEl?.replaceChildren();
		fittedVaultPins = false;
		await loadMap();
		panMap();
		drawCenter();
		drawResultMarkers();
		fitVaultPins();
	}

	onMount(() => {
		void loadVaultPins();
		void (async () => {
			await loadMap();
			drawCenter();
			drawResultMarkers();
			fitVaultPins();
		})();
		const handleThemeChange = () => {
			void reloadMapForTheme();
		};
		document.addEventListener('restauranteer-themechange', handleThemeChange);
		return () => {
			document.removeEventListener('restauranteer-themechange', handleThemeChange);
			destroyMap();
		};
	});

	$effect(() => {
		if (center) {
			void radius;
			void minRating;
			void cuisines;
			drawCenter();
			void runQuery();
		}
	});
	$effect(() => {
		void vaultPins;
		void filteredVaultPins;
		void results;
		drawResultMarkers();
		fitVaultPins();
	});
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href="/" />
	<h1 class="mt-2 text-2xl font-semibold text-primary">Near me</h1>
	<p class="mt-1 text-sm text-secondary">
		Saved places are pinned. Tap a spot to search nearby.
	</p>
</header>

<div class="relative mt-3 h-[40vh] w-full bg-panel">
	<div bind:this={mapEl} class="absolute inset-0"></div>
	{#if effectiveProvider === 'mapbox' && !data.mapboxToken}
		<div class="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-secondary">
			Set MAPBOX_PUBLIC_TOKEN in .env to enable the map. You can still filter results below.
		</div>
	{:else if effectiveProvider === 'google' && !data.googleMapsKey}
		<div class="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-secondary">
			Set GOOGLE_MAPS_PUBLIC_KEY in .env to enable the map. You can still filter results below.
		</div>
	{:else if !center}
		<div class="absolute inset-x-0 bottom-2 text-center text-[11px] text-secondary">
			{#if effectiveProvider === 'apple'}
				Saved places are pinned. Use location to search nearby.
			{:else}
				Saved places are pinned. Tap the map for Google results.
			{/if}
		</div>
	{/if}
</div>

<div class="flex flex-wrap items-center gap-2 px-5 pt-3">
	<button
		type="button"
		onclick={useMyLocation}
		class="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-on-accent"
	>
		📍 Use my location
	</button>
	<button
		type="button"
		onclick={cycleRadius}
		class="rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-secondary"
	>
		{radius >= 1000 ? `${radius / 1000}km` : `${radius}m`}
	</button>
	<button
		type="button"
		onclick={cycleRating}
		class="rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-secondary"
	>
		{minRating > 0 ? `★ ${minRating}+` : 'Any ★'}
	</button>
	<button
		type="button"
		onclick={() => (pickingCuisine = true)}
		class="rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-secondary"
	>
		{cuisines.length === 0 ? 'Cuisine: any' : `Cuisine: ${cuisines.length}`}
	</button>
</div>
{#if geoErr}
	<p class="px-5 pt-1 text-[11px] text-warning">{geoErr}</p>
{/if}
{#if vaultPinsErr}
	<p class="px-5 pt-1 text-[11px] text-warning">{vaultPinsErr}</p>
{/if}
{#if queryErr}
	<p class="px-5 pt-1 text-[11px] text-danger">{queryErr}</p>
{/if}

<section class="px-5 pt-4 pb-6">
	{#if !center}
		{#if vaultPinsLoading && vaultPins.length === 0}
			<p class="text-sm text-tertiary">Loading saved places…</p>
		{:else if vaultPins.length === 0}
			<p class="text-sm text-tertiary">
				No saved places yet. Tap a spot on the map to search nearby.
			</p>
		{:else}
			<p class="mb-2 text-[10px] tracking-widest text-tertiary uppercase">
				{#if filtersActive}
					{filteredVaultPins.length} / {vaultPins.length} saved {vaultPins.length === 1
						? 'place'
						: 'places'} match · drop a pin to also filter by distance
				{:else}
					{vaultPins.length} saved {vaultPins.length === 1 ? 'place' : 'places'} · tap a spot above
					to filter by distance
				{/if}
			</p>
			{#if filteredVaultPins.length === 0}
				<p class="text-sm text-tertiary">
					No vault places match these filters.
					{#if minRating > 0}Try lowering the rating threshold.{/if}
					{#if cuisines.length > 0}Try clearing cuisine filters.{/if}
				</p>
			{:else}
				<ul class="space-y-2">
					{#each filteredVaultPins as p (p.uuid)}
						<li>
							<button
								type="button"
								onclick={() => openVaultPin(p)}
								class="block w-full min-w-0 rounded-2xl border border-line bg-panel/50 p-3 text-left"
							>
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0 flex-1">
										<span class="text-[10px] tracking-widest text-accent uppercase">★ Vault</span>
										<h3 class="mt-0.5 truncate text-sm font-medium text-primary">{p.name}</h3>
										{#if p.suburb}
											<p class="truncate text-xs text-secondary">{p.suburb}</p>
										{/if}
										{#if p.cuisine.length > 0}
											<div class="mt-1.5 flex flex-wrap gap-1">
												{#each p.cuisine.slice(0, 4) as c (c)}
													<span
														class="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-secondary"
													>
														{c}
													</span>
												{/each}
											</div>
										{/if}
									</div>
									{#if p.rating != null}
										<span class="shrink-0 text-xs text-rating">★ {p.rating}</span>
									{/if}
								</div>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{:else if loading && results.length === 0}
		<p class="text-sm text-tertiary">Searching…</p>
	{:else if results.length === 0}
		<p class="text-sm text-tertiary">
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
						class="block w-full min-w-0 rounded-2xl border border-line bg-panel/50 p-3 text-left"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									{#if r.source === 'vault'}
										<span class="text-[10px] tracking-widest text-accent uppercase"
											>★ Vault</span
										>
									{:else}
										<span class="text-[10px] tracking-widest text-tertiary uppercase"
											>Google</span
										>
									{/if}
									<span class="text-[10px] text-tertiary">{formatDistance(r.distance_m)}</span>
								</div>
								<h3 class="mt-0.5 truncate text-sm font-medium text-primary">{r.name}</h3>
								{#if r.source === 'vault' && (r.suburb || r.address)}
									<p class="truncate text-xs text-secondary">{r.suburb ?? r.address}</p>
								{:else if r.source === 'google' && r.address}
									<p class="truncate text-xs text-secondary">{r.address}</p>
								{/if}
								{#if r.cuisine.length > 0}
									<div class="mt-1.5 flex flex-wrap gap-1">
										{#each r.cuisine.slice(0, 4) as c (c)}
											<span class="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-secondary"
												>{c}</span
											>
										{/each}
									</div>
								{/if}
							</div>
							{#if r.rating != null}
								<span class="shrink-0 text-xs text-rating">★ {r.rating}</span>
							{/if}
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if selectedPin}
	<button
		type="button"
		class="fixed inset-0 z-40 bg-transparent"
		aria-label="Dismiss pin preview"
		onclick={() => (selectedPin = null)}
	></button>
	<section
		class="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-line bg-panel p-5 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-xl"
	>
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<span
						class="text-[10px] tracking-widest uppercase"
						class:text-accent={selectedPin.source === 'vault'}
						class:text-tertiary={selectedPin.source === 'google'}
					>
						{selectedPin.source === 'vault' ? '★ Vault' : 'Google'}
					</span>
					{#if 'distance_m' in selectedPin && selectedPin.distance_m != null}
						<span class="text-[10px] text-tertiary">{formatDistance(selectedPin.distance_m)}</span>
					{/if}
				</div>
				<h2 class="mt-0.5 truncate text-base font-medium text-primary">{selectedPin.name}</h2>
				{#if selectedPin.source === 'vault' && (selectedPin.suburb || selectedPin.address)}
					<p class="truncate text-xs text-secondary">{selectedPin.suburb ?? selectedPin.address}</p>
				{:else if selectedPin.source === 'google' && selectedPin.address}
					<p class="truncate text-xs text-secondary">{selectedPin.address}</p>
				{/if}
			</div>
			{#if selectedPin.rating != null}
				<span class="shrink-0 text-sm text-rating">★ {selectedPin.rating}</span>
			{/if}
		</div>
		{#if selectedPin.cuisine.length > 0}
			<div class="mt-3 flex flex-wrap gap-1">
				{#each selectedPin.cuisine.slice(0, 4) as c (c)}
					<span class="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-secondary">{c}</span>
				{/each}
			</div>
		{/if}
		<div class="mt-4 grid grid-cols-2 gap-2">
			<button
				type="button"
				onclick={openSelected}
				class="rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-on-accent"
			>
				{selectedPin.source === 'vault' ? 'Open' : 'View'}
			</button>
			{#if selectedNavHref}
				<a
					href={selectedNavHref}
					target="_blank"
					rel="noopener noreferrer"
					class="rounded-2xl border border-line bg-panel/70 px-5 py-3 text-center text-sm font-medium text-secondary"
				>
					{navLabel}
				</a>
			{:else}
				<button
					type="button"
					disabled
					class="rounded-2xl border border-line bg-panel/40 px-5 py-3 text-sm font-medium text-tertiary opacity-60"
				>
					No route
				</button>
			{/if}
		</div>
	</section>
{/if}

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

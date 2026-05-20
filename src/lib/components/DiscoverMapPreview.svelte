<script lang="ts">
	/// <reference types="google.maps" />
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { loadMapKit } from '$lib/appleMapKit';
	import { loadGoogleMaps, GOOGLE_DARK_STYLES } from '$lib/googleMaps';

	type Preferences = {
		default_map_provider: string;
	};

	type Props = {
		mapboxToken: string;
		googleMapsKey: string;
		googleEnabled: boolean;
		appleAvailable: boolean;
		preferences: Preferences;
	};

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

	type MapTheme = {
		brightness: 'light' | 'dark';
		accent: string;
		onAccent: string;
		text: string;
		mapSecondary: string;
	};

	const DEFAULT_CENTER = { lat: -37.8136, lng: 144.9631 };
	const RADIUS_M = 2000;

	let { mapboxToken, googleMapsKey, googleEnabled, appleAvailable, preferences }: Props = $props();

	const effectiveProvider = $derived.by<'mapbox' | 'apple' | 'google'>(() => {
		const want = preferences.default_map_provider;
		if (want === 'apple' && appleAvailable) return 'apple';
		if (want === 'google' && googleMapsKey) return 'google';
		return 'mapbox';
	});

	let mapEl = $state<HTMLDivElement | null>(null);
	let mapRef: any = null;
	let centerMarker: any = null;
	let resultMarkers: any[] = [];
	let center = $state<{ lat: number; lng: number } | null>(null);
	let results = $state<Result[]>([]);
	let loading = $state(false);
	let locating = $state(false);
	let err = $state<string | null>(null);
	// svelte-ignore state_referenced_locally
	let source = $state<'all' | 'vault'>(googleEnabled ? 'all' : 'vault');

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

	async function loadMap() {
		if (!mapEl) return;
		const theme = readMapTheme();
		if (effectiveProvider === 'apple') {
			const mapkit = await loadMapKit();
			if (!mapEl) return;
			mapRef = new mapkit.Map(mapEl, {
				center: new mapkit.Coordinate(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
				cameraDistance: 5000,
				showsCompass: mapkit.FeatureVisibility.Hidden,
				showsScale: mapkit.FeatureVisibility.Hidden,
				colorScheme:
					theme.brightness === 'dark'
						? mapkit.Map.ColorSchemes.Dark
						: mapkit.Map.ColorSchemes.Light
			});
			return;
		}
		if (effectiveProvider === 'google') {
			if (!googleMapsKey) return;
			const google = await loadGoogleMaps(googleMapsKey);
			if (!mapEl) return;
			mapRef = new google.maps.Map(mapEl, {
				center: DEFAULT_CENTER,
				zoom: 12,
				disableDefaultUI: false,
				mapTypeControl: false,
				streetViewControl: false,
				fullscreenControl: false,
				styles: theme.brightness === 'dark' ? GOOGLE_DARK_STYLES : []
			});
			return;
		}
		if (!mapboxToken) return;
		const mapboxgl = (await import('mapbox-gl')).default;
		await import('mapbox-gl/dist/mapbox-gl.css');
		mapboxgl.accessToken = mapboxToken;
		mapRef = new mapboxgl.Map({
			container: mapEl,
			style: mapboxStyle(theme),
			center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
			zoom: 12
		});
	}

	function clearMarkers() {
		if (effectiveProvider === 'apple') {
			for (const marker of resultMarkers) mapRef?.removeAnnotation?.(marker);
			if (centerMarker) mapRef?.removeAnnotation?.(centerMarker);
		} else if (effectiveProvider === 'google') {
			for (const marker of resultMarkers) marker.setMap?.(null);
			centerMarker?.setMap?.(null);
		} else {
			for (const marker of resultMarkers) marker.remove?.();
			centerMarker?.remove?.();
		}
		resultMarkers = [];
		centerMarker = null;
	}

	function destroyMap() {
		try {
			clearMarkers();
			if (effectiveProvider === 'apple') mapRef?.destroy?.();
			else if (effectiveProvider === 'mapbox') mapRef?.remove?.();
		} catch {
			/* ignore */
		}
		mapRef = null;
	}

	function panToCenter() {
		if (!mapRef || !center) return;
		if (effectiveProvider === 'apple') {
			mapRef.region = new window.mapkit.CoordinateRegion(
				new window.mapkit.Coordinate(center.lat, center.lng),
				new window.mapkit.CoordinateSpan(0.025, 0.025)
			);
			return;
		}
		if (effectiveProvider === 'google') {
			mapRef.panTo(center);
			mapRef.setZoom(14);
			return;
		}
		mapRef.flyTo({ center: [center.lng, center.lat], zoom: 14, duration: 500 });
	}

	function drawMarkers() {
		if (!mapRef) return;
		clearMarkers();
		const theme = readMapTheme();
		if (center) {
			if (effectiveProvider === 'apple') {
				centerMarker = new window.mapkit.MarkerAnnotation(
					new window.mapkit.Coordinate(center.lat, center.lng),
					{ color: theme.accent, glyphText: '●', title: 'Here' }
				);
				mapRef.addAnnotation(centerMarker);
			} else if (effectiveProvider === 'google') {
				centerMarker = new window.google.maps.Marker({
					position: center,
					map: mapRef,
					title: 'Here',
					icon: {
						path: window.google.maps.SymbolPath.CIRCLE,
						scale: 8,
						fillColor: theme.accent,
						fillOpacity: 1,
						strokeColor: theme.text,
						strokeWeight: 2
					}
				});
			} else {
				void import('mapbox-gl').then(({ default: mapboxgl }) => {
					if (!center || !mapRef) return;
					const el = document.createElement('div');
					el.className =
						'h-4 w-4 rounded-full border-2 border-white bg-accent shadow ring-4 ring-accent-ring/30';
					centerMarker = new mapboxgl.Marker({ element: el })
						.setLngLat([center.lng, center.lat])
						.addTo(mapRef);
				});
			}
		}

		if (effectiveProvider === 'apple') {
			for (const r of results) {
				const marker = new window.mapkit.MarkerAnnotation(
					new window.mapkit.Coordinate(r.lat, r.lng),
					{
						color: r.source === 'vault' ? theme.accent : theme.mapSecondary,
						glyphText: r.source === 'vault' ? '★' : '•',
						title: r.name
					}
				);
				marker.addEventListener('select', () => openResult(r));
				mapRef.addAnnotation(marker);
				resultMarkers.push(marker);
			}
			return;
		}

		if (effectiveProvider === 'google') {
			for (const r of results) {
				const marker = new window.google.maps.Marker({
					position: { lat: r.lat, lng: r.lng },
					map: mapRef,
					title: r.name,
					label: {
						text: r.source === 'vault' ? '★' : '•',
						color: r.source === 'vault' ? theme.onAccent : theme.text,
						fontSize: '10px',
						fontWeight: '700'
					},
					icon: {
						path: window.google.maps.SymbolPath.CIRCLE,
						scale: r.source === 'vault' ? 12 : 9,
						fillColor: r.source === 'vault' ? theme.accent : theme.mapSecondary,
						fillOpacity: 1,
						strokeColor: theme.text,
						strokeWeight: r.source === 'vault' ? 2 : 1
					}
				});
				marker.addListener('click', () => openResult(r));
				resultMarkers.push(marker);
			}
			return;
		}

		void import('mapbox-gl').then(({ default: mapboxgl }) => {
			if (!mapRef) return;
			for (const r of results) {
				const el = document.createElement('button');
				el.type = 'button';
				el.className =
					r.source === 'vault'
						? 'flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-primary bg-accent text-[10px] text-on-accent shadow'
						: 'flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-secondary bg-map-secondary text-[9px] text-primary';
				el.textContent = r.source === 'vault' ? '★' : '•';
				el.setAttribute('aria-label', r.name);
				el.title = r.name;
				el.addEventListener('click', () => openResult(r));
				resultMarkers.push(new mapboxgl.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(mapRef));
			}
		});
	}

	async function queryNearby() {
		if (!center) return;
		loading = true;
		err = null;
		try {
			const params = new URLSearchParams({
				lat: String(center.lat),
				lng: String(center.lng),
				radius: String(RADIUS_M),
				source
			});
			const res = await fetch(`/api/near?${params.toString()}`);
			if (!res.ok) throw new Error(`Nearby search failed (${res.status})`);
			const body = (await res.json()) as { results: Result[]; google_enabled: boolean };
			results = body.results;
			if (!body.google_enabled && source === 'all') source = 'vault';
			panToCenter();
			drawMarkers();
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function useMyLocation() {
		if (!navigator.geolocation) {
			err = 'Geolocation not supported';
			return;
		}
		locating = true;
		err = null;
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				center = { lat: pos.coords.latitude, lng: pos.coords.longitude };
				locating = false;
				void queryNearby();
			},
			(e) => {
				locating = false;
				err = e.message || 'Location unavailable';
			},
			{ enableHighAccuracy: true, timeout: 8000 }
		);
	}

	function toggleSource() {
		if (!googleEnabled) return;
		source = source === 'all' ? 'vault' : 'all';
		if (center) void queryNearby();
	}

	function openResult(result: Result) {
		if (result.source === 'vault') void goto(`/restaurant/${result.uuid}`);
		else void goto(`/place/${result.place_id}`);
	}

	onMount(() => {
		void loadMap();
		const handleThemeChange = async () => {
			destroyMap();
			mapEl?.replaceChildren();
			await loadMap();
			if (center) {
				panToCenter();
				drawMarkers();
			}
		};
		document.addEventListener('restauranteer-themechange', handleThemeChange);
		return () => {
			document.removeEventListener('restauranteer-themechange', handleThemeChange);
			destroyMap();
		};
	});
</script>

<section class="px-5 pt-5">
	<div class="flex items-center justify-between gap-3">
		<div>
			<h2 class="text-xs tracking-widest text-tertiary uppercase">Map</h2>
			<p class="mt-0.5 text-xs text-secondary">
				{results.length > 0 ? `${results.length} nearby` : 'Vault and Google pins'}
			</p>
		</div>
		<div class="flex items-center gap-2">
			{#if googleEnabled}
				<button
					type="button"
					onclick={toggleSource}
					class="rounded-full border border-line bg-panel px-3 py-1.5 text-xs"
					class:text-success={source === 'all'}
					class:text-secondary={source === 'vault'}
				>
					{source === 'all' ? 'Vault + Google' : 'Vault'}
				</button>
			{/if}
			<button
				type="button"
				onclick={useMyLocation}
				disabled={locating || loading}
				class="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50"
			>
				{locating ? 'Locating...' : 'Use location'}
			</button>
		</div>
	</div>

	<div class="relative mt-3 h-64 overflow-hidden rounded-2xl border border-line bg-panel">
		<div bind:this={mapEl} class="absolute inset-0"></div>
		{#if effectiveProvider === 'mapbox' && !mapboxToken}
			<div class="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-secondary">
				Set MAPBOX_PUBLIC_TOKEN in .env to enable this map.
			</div>
		{:else if effectiveProvider === 'google' && !googleMapsKey}
			<div class="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-secondary">
				Set GOOGLE_MAPS_PUBLIC_KEY in .env to enable this map.
			</div>
		{:else if !center}
			<div class="absolute inset-x-0 bottom-2 text-center text-[11px] text-secondary">
				Use your location to show nearby pins.
			</div>
		{/if}
		{#if loading}
			<div class="absolute inset-0 flex items-center justify-center bg-canvas/50 text-xs text-secondary">
				Loading pins...
			</div>
		{/if}
	</div>

	{#if err}
		<p class="mt-2 text-xs text-warning">{err}</p>
	{:else if center && results.length === 0 && !loading}
		<p class="mt-2 text-xs text-tertiary">No nearby pins within 2km.</p>
	{/if}
</section>

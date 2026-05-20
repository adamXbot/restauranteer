<script lang="ts">
	import { goto } from '$app/navigation';

	type VaultHit = {
		uuid: string;
		name: string;
		address: string | null;
		suburb: string | null;
		google_place_id: string | null;
	};
	type GoogleHit = {
		place_id: string;
		text: string;
		primary_text: string;
		secondary_text: string;
	};

	let query = $state('');
	let vault = $state<VaultHit[]>([]);
	let google = $state<GoogleHit[]>([]);
	let googleEnabled = $state(true);
	let loading = $state(false);
	let lastError = $state<string | null>(null);
	let coords = $state<{ lat: number; lng: number } | null>(null);
	let geoStatus = $state<'idle' | 'requesting' | 'denied' | 'ok'>('idle');
	let timer: ReturnType<typeof setTimeout> | null = null;

	function runQuery(q: string) {
		if (q.trim().length < 2) {
			vault = [];
			google = [];
			loading = false;
			return;
		}
		loading = true;
		const params = new URLSearchParams({ q });
		if (coords) {
			params.set('lat', String(coords.lat));
			params.set('lng', String(coords.lng));
		}
		fetch(`/api/search?${params.toString()}`)
			.then((r) => {
				if (!r.ok) throw new Error(`Search failed: ${r.status}`);
				return r.json();
			})
			.then((data) => {
				vault = data.vault;
				google = data.google;
				googleEnabled = data.google_enabled;
				lastError = null;
				loading = false;
			})
			.catch((e) => {
				lastError = String(e);
				loading = false;
			});
	}

	$effect(() => {
		const q = query;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => runQuery(q), 250);
	});

	function requestLocation() {
		if (!navigator.geolocation) return;
		geoStatus = 'requesting';
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
				geoStatus = 'ok';
				if (query.length >= 2) runQuery(query);
			},
			() => {
				geoStatus = 'denied';
			},
			{ enableHighAccuracy: true, timeout: 8000 }
		);
	}

	function openVault(uuid: string) {
		query = '';
		goto(`/restaurant/${uuid}`);
	}
	function openGoogle(placeId: string) {
		query = '';
		goto(`/place/${placeId}`);
	}
</script>

<div class="sticky top-0 z-10 bg-slate-950/90 px-5 pt-4 pb-3 backdrop-blur">
	<div class="flex items-center gap-2">
		<input
			type="search"
			bind:value={query}
			placeholder="Name, cuisine, suburb…"
			class="flex-1 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-orange-600/60 focus:ring-2 focus:ring-orange-600/30 focus:outline-none"
			enterkeyhint="search"
			autocomplete="off"
			autocorrect="off"
			autocapitalize="off"
			spellcheck="false"
		/>
		<button
			type="button"
			onclick={requestLocation}
			aria-label="Use my location"
			class="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs text-slate-400"
			class:!text-emerald-400={geoStatus === 'ok'}
		>
			📍
		</button>
	</div>
	{#if query.trim().length < 2}
		<p class="mt-1 text-[11px] text-slate-500">
			Combine words — e.g. <span class="text-slate-400">greek brunch</span>, <span class="text-slate-400">ramen newtown</span>.
		</p>
	{/if}
	{#if geoStatus === 'denied'}
		<p class="mt-1 text-[11px] text-slate-500">Location denied — search results won't be biased.</p>
	{/if}
	{#if !googleEnabled && query.trim().length >= 2}
		<p class="mt-1 text-[11px] text-amber-400/80">
			Set <code class="font-mono">GOOGLE_PLACES_API_KEY</code> in <code class="font-mono">.env</code
			> to enable Google search.
		</p>
	{/if}
	{#if lastError}
		<p class="mt-1 text-[11px] text-red-400">{lastError}</p>
	{/if}
</div>

{#if query.trim().length >= 2}
	<section class="px-5 pt-2 pb-6">
		{#if vault.length > 0}
			<h3 class="mt-2 mb-1 text-[10px] tracking-widest text-slate-500 uppercase">In your vault</h3>
			<ul class="space-y-2">
				{#each vault as r (r.uuid)}
					<li>
						<button
							onclick={() => openVault(r.uuid)}
							class="block w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left"
						>
							<p class="text-sm font-medium text-slate-100">★ {r.name}</p>
							{#if r.suburb || r.address}
								<p class="text-xs text-slate-500">{r.suburb ?? r.address}</p>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if google.length > 0}
			<h3 class="mt-3 mb-1 text-[10px] tracking-widest text-slate-500 uppercase">Google</h3>
			<ul class="space-y-2">
				{#each google as g (g.place_id)}
					<li>
						<button
							onclick={() => openGoogle(g.place_id)}
							class="block w-full rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5 text-left"
						>
							<p class="text-sm font-medium text-slate-100">{g.primary_text}</p>
							{#if g.secondary_text}
								<p class="text-xs text-slate-500">{g.secondary_text}</p>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if !loading && vault.length === 0 && google.length === 0}
			<p class="mt-4 text-sm text-slate-500">No matches.</p>
		{/if}
	</section>
{/if}

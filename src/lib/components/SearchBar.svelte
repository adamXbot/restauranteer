<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	// `allowImport` turns this into a universal input: a pasted URL is offered for
	// import (into the inbox) instead of searched.
	let {
		allowImport = false,
		placeholder = 'Name, cuisine, suburb…'
	}: { allowImport?: boolean; placeholder?: string } = $props();

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
	let importing = $state(false);
	let importErr = $state<string | null>(null);

	function looksLikeUrl(q: string): boolean {
		return /^https?:\/\/\S+$/i.test(q.trim());
	}
	const isUrl = $derived(allowImport && looksLikeUrl(query));
	function hostOf(q: string): string {
		try {
			return new URL(q.trim()).hostname.replace(/^www\./, '');
		} catch {
			return 'link';
		}
	}

	async function importUrl() {
		const url = query.trim();
		if (!url) return;
		importing = true;
		importErr = null;
		try {
			const res = await fetch('/api/inbox', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url })
			});
			if (!res.ok) {
				importErr = (await res.text()) || `Failed: ${res.status}`;
				return;
			}
			const result = (await res.json()) as
				| { status: 'added' | 'already_pending' }
				| { status: 'already_attached'; uuid: string };
			query = '';
			await invalidateAll();
			if (result.status === 'already_attached') await goto(`/restaurant/${result.uuid}`);
			else await goto('/inbox');
		} catch (e) {
			importErr = String(e instanceof Error ? e.message : e);
		} finally {
			importing = false;
		}
	}

	function runQuery(q: string) {
		if (looksLikeUrl(q) && allowImport) {
			vault = [];
			google = [];
			loading = false;
			return;
		}
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

<div class="relative">
	<div class="flex items-center gap-2">
		<input
			type="search"
			bind:value={query}
			{placeholder}
			class="min-w-0 flex-1 rounded-2xl border border-line bg-panel px-4 py-2.5 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
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
			class="shrink-0 rounded-xl border border-line bg-panel px-3 py-2.5 text-xs text-secondary"
			class:!text-success={geoStatus === 'ok'}
		>
			📍
		</button>
	</div>
	{#if geoStatus === 'denied'}
		<p class="mt-1 text-[11px] text-tertiary">Location denied — search results won't be biased.</p>
	{/if}
	{#if !googleEnabled && query.trim().length >= 2}
		<p class="mt-1 text-[11px] text-warning/80">
			Set <code class="font-mono">GOOGLE_PLACES_API_KEY</code> in <code class="font-mono">.env</code
			> to enable Google search.
		</p>
	{/if}
	{#if lastError}
		<p class="mt-1 text-[11px] text-danger">{lastError}</p>
	{/if}

	{#if isUrl}
		<section
			class="absolute inset-x-0 top-full z-30 mt-2 rounded-2xl border border-line bg-panel p-3 shadow-xl shadow-black/30"
		>
			<button
				type="button"
				onclick={importUrl}
				disabled={importing}
				class="block w-full rounded-xl border border-accent/40 bg-accent-soft px-3 py-2.5 text-left disabled:opacity-50"
			>
				<p class="text-sm font-medium text-accent">{importing ? 'Importing…' : 'Import this link'}</p>
				<p class="text-xs text-tertiary">{hostOf(query)} · adds it to your inbox</p>
			</button>
			{#if importErr}
				<p class="mt-2 text-[11px] text-danger">{importErr}</p>
			{/if}
		</section>
	{:else if query.trim().length >= 2}
		<section
			class="absolute inset-x-0 top-full z-30 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-panel p-3 shadow-xl shadow-black/30"
		>
			{#if vault.length > 0}
				<h3 class="mt-1 mb-1 text-[10px] tracking-widest text-tertiary uppercase">In your vault</h3>
				<ul class="space-y-2">
					{#each vault as r (r.uuid)}
						<li>
							<button
								onclick={() => openVault(r.uuid)}
								class="block w-full rounded-xl border border-line bg-panel/60 px-3 py-2.5 text-left"
							>
								<p class="text-sm font-medium text-primary">★ {r.name}</p>
								{#if r.suburb || r.address}
									<p class="text-xs text-tertiary">{r.suburb ?? r.address}</p>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if google.length > 0}
				<h3 class="mt-3 mb-1 text-[10px] tracking-widest text-tertiary uppercase">Google</h3>
				<ul class="space-y-2">
					{#each google as g (g.place_id)}
						<li>
							<button
								onclick={() => openGoogle(g.place_id)}
								class="block w-full rounded-xl border border-line bg-panel/40 px-3 py-2.5 text-left"
							>
								<p class="text-sm font-medium text-primary">{g.primary_text}</p>
								{#if g.secondary_text}
									<p class="text-xs text-tertiary">{g.secondary_text}</p>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if !loading && vault.length === 0 && google.length === 0}
				<p class="px-1 py-3 text-sm text-tertiary">No matches.</p>
			{/if}
		</section>
	{/if}
</div>

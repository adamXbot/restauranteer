<script lang="ts">
	type Candidate = {
		place_id: string;
		name: string;
		address: string | null;
		lat: number | null;
		lng: number | null;
	};

	type Props = {
		restaurantUuid: string;
		restaurantName: string;
		onSaved?: () => void;
		onClose?: () => void;
	};
	let { restaurantUuid, restaurantName, onSaved, onClose }: Props = $props();

	// Google Maps search (mirrors EnrichLocationSheet UX so adding a maps data
	// source from the "Link URL" flow feels the same as adding one from a
	// missing phone/website slot).
	let googleQuery = $state('');
	let candidates = $state<Candidate[]>([]);
	let searching = $state(false);
	let savingPlaceId = $state<string | null>(null);
	let googleUnavailable = $state(false);

	// Generic URL paste (Apple Maps, Google Maps URL, articles, social)
	let url = $state('');
	let busy = $state(false);
	let err = $state<string | null>(null);

	async function runSearch(q?: string) {
		searching = true;
		err = null;
		try {
			const params = new URLSearchParams();
			if (q && q.trim()) params.set('q', q.trim());
			const res = await fetch(`/api/restaurants/${restaurantUuid}/enrich?${params}`);
			if (res.status === 503) {
				googleUnavailable = true;
				candidates = [];
				return;
			}
			if (!res.ok) {
				err = await res.text();
				candidates = [];
				return;
			}
			const data = (await res.json()) as { query: string; candidates: Candidate[] };
			googleQuery = data.query;
			candidates = data.candidates;
		} catch (e) {
			err = String(e);
			candidates = [];
		} finally {
			searching = false;
		}
	}

	async function pickCandidate(c: Candidate) {
		savingPlaceId = c.place_id;
		err = null;
		try {
			const res = await fetch(`/api/restaurants/${restaurantUuid}/enrich`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ place_id: c.place_id })
			});
			if (!res.ok) {
				err = await res.text();
				savingPlaceId = null;
				return;
			}
			onSaved?.();
		} catch (e) {
			err = String(e);
			savingPlaceId = null;
		}
	}

	async function save() {
		busy = true;
		err = null;
		try {
			// /api/import handles any URL we recognise and respects link_to_uuid —
			// adds the article to this restaurant for article URLs, or merges Google
			// Place data into this restaurant for Google Maps URLs.
			const res = await fetch('/api/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: url.trim(), link_to_uuid: restaurantUuid })
			});
			if (!res.ok) {
				err = await res.text();
				busy = false;
				return;
			}
			onSaved?.();
		} catch (e) {
			err = String(e);
			busy = false;
		}
	}

	$effect(() => {
		void runSearch();
	});
</script>

<div
	class="fixed inset-0 z-40 flex flex-col justify-end bg-overlay"
	role="dialog"
	aria-modal="true"
>
	<button
		type="button"
		class="absolute inset-0 -z-10 h-full w-full cursor-default"
		aria-label="Close"
		onclick={() => onClose?.()}
	></button>
	<section
		class="max-h-[88vh] overflow-y-auto rounded-t-3xl border-t border-line bg-panel p-5 pb-8"
	>
		<header class="mb-3 flex items-baseline justify-between gap-2">
			<div>
				<h2 class="text-base font-medium text-primary">Add a source</h2>
				<p class="text-xs text-tertiary">{restaurantName}</p>
			</div>
			<button type="button" onclick={() => onClose?.()} class="text-xs text-secondary">Cancel</button>
		</header>

		{#if !googleUnavailable}
			<div>
				<p class="mb-2 text-[10px] tracking-widest text-tertiary uppercase">Maps search</p>
				<div class="flex gap-2">
					<input
						type="text"
						bind:value={googleQuery}
						placeholder="Restaurant name + suburb"
						class="flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
						autocomplete="off"
						autocorrect="off"
						spellcheck="false"
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								void runSearch(googleQuery);
							}
						}}
					/>
					<button
						type="button"
						onclick={() => runSearch(googleQuery)}
						disabled={searching}
						class="rounded-xl border border-line-strong bg-panel-2 px-3 py-2 text-xs text-secondary disabled:opacity-50"
					>
						{searching ? '…' : 'Search'}
					</button>
				</div>

				<ul class="mt-3 space-y-2">
					{#if searching && candidates.length === 0}
						<li class="text-xs text-tertiary">Searching Google Places…</li>
					{:else if candidates.length === 0 && !err}
						<li class="text-xs text-tertiary">No matches yet — refine the query above.</li>
					{/if}
					{#each candidates as c (c.place_id)}
						<li>
							<button
								type="button"
								onclick={() => pickCandidate(c)}
								disabled={savingPlaceId !== null}
								class="block w-full rounded-xl border border-line bg-panel/40 p-3 text-left hover:border-line-strong disabled:opacity-50"
							>
								<p class="text-sm font-medium text-primary">{c.name}</p>
								{#if c.address}
									<p class="mt-0.5 text-xs text-secondary">{c.address}</p>
								{/if}
								<p class="mt-1 text-[11px] text-accent/80">
									{savingPlaceId === c.place_id ? 'Saving…' : 'Use this match'}
								</p>
							</button>
						</li>
					{/each}
				</ul>
			</div>

			<div class="my-5 flex items-center gap-3 text-[10px] tracking-widest text-tertiary uppercase">
				<span class="h-px flex-1 bg-line"></span>
				<span>or paste a URL</span>
				<span class="h-px flex-1 bg-line"></span>
			</div>
		{/if}

		<div>
			{#if googleUnavailable}
				<p class="mb-2 text-[10px] tracking-widest text-tertiary uppercase">Paste a URL</p>
				<p class="mb-2 text-[11px] text-tertiary">
					Google search isn't configured. Paste Google Maps, Apple Maps, or any source URL.
				</p>
			{/if}
			<input
				type="url"
				bind:value={url}
				placeholder="Apple Maps share URL, article, Instagram, blog…"
				class="w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
				autocomplete="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
			/>

			{#if err}
				<p class="mt-2 text-xs text-danger">{err}</p>
			{/if}

			<button
				type="button"
				onclick={save}
				disabled={busy || url.trim().length === 0}
				class="mt-4 w-full rounded-2xl bg-accent px-5 py-3 text-center text-sm font-medium text-on-accent disabled:opacity-50"
			>
				{busy ? 'Linking…' : 'Link URL'}
			</button>
		</div>
	</section>
</div>

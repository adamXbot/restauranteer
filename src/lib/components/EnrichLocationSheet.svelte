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
		missingField: 'phone' | 'website' | 'address' | 'location';
		onSaved?: () => void;
		onClose?: () => void;
	};
	let { restaurantUuid, restaurantName, missingField, onSaved, onClose }: Props = $props();

	let query = $state('');
	let candidates = $state<Candidate[]>([]);
	let searching = $state(false);
	let saving = $state<string | null>(null);
	let err = $state<string | null>(null);
	let googleUnavailable = $state(false);

	let pasteUrl = $state('');
	let pasting = $state(false);

	const FIELD_LABEL: Record<Props['missingField'], string> = {
		phone: 'phone number',
		website: 'website',
		address: 'address',
		location: 'location'
	};

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
			query = data.query;
			candidates = data.candidates;
		} catch (e) {
			err = String(e);
			candidates = [];
		} finally {
			searching = false;
		}
	}

	async function pickCandidate(c: Candidate) {
		saving = c.place_id;
		err = null;
		try {
			const res = await fetch(`/api/restaurants/${restaurantUuid}/enrich`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ place_id: c.place_id })
			});
			if (!res.ok) {
				err = await res.text();
				saving = null;
				return;
			}
			onSaved?.();
		} catch (e) {
			err = String(e);
			saving = null;
		}
	}

	async function importUrl() {
		if (!pasteUrl.trim()) return;
		pasting = true;
		err = null;
		try {
			const res = await fetch('/api/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: pasteUrl.trim(), link_to_uuid: restaurantUuid })
			});
			if (!res.ok) {
				err = await res.text();
				pasting = false;
				return;
			}
			onSaved?.();
		} catch (e) {
			err = String(e);
			pasting = false;
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
	<section class="max-h-[88vh] overflow-y-auto rounded-t-3xl border-t border-line bg-panel p-5 pb-8">
		<header class="mb-3 flex items-baseline justify-between gap-2">
			<div>
				<h2 class="text-base font-medium text-primary">Add {FIELD_LABEL[missingField]}</h2>
				<p class="text-xs text-tertiary">{restaurantName} · Google search or Maps URL.</p>
			</div>
			<button type="button" onclick={() => onClose?.()} class="text-xs text-secondary">Cancel</button>
		</header>

		{#if !googleUnavailable}
			<div class="flex gap-2">
				<input
					type="text"
					bind:value={query}
					placeholder="Restaurant name + suburb"
					class="flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
					autocomplete="off"
					autocorrect="off"
					spellcheck="false"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							void runSearch(query);
						}
					}}
				/>
				<button
					type="button"
					onclick={() => runSearch(query)}
					disabled={searching}
					class="rounded-xl border border-line-strong bg-panel-2 px-3 py-2 text-xs text-secondary disabled:opacity-50"
				>
					{searching ? '…' : 'Search'}
				</button>
			</div>
		{/if}

		{#if err}
			<p class="mt-2 text-xs text-danger">{err}</p>
		{/if}

		{#if !googleUnavailable}
			<ul class="mt-3 space-y-2">
				{#if searching && candidates.length === 0}
					<li class="text-xs text-tertiary">Searching Google Places…</li>
				{:else if candidates.length === 0 && !err}
					<li class="text-xs text-tertiary">No matches yet.</li>
				{/if}
				{#each candidates as c (c.place_id)}
					<li>
						<button
							type="button"
							onclick={() => pickCandidate(c)}
							disabled={saving !== null}
							class="block w-full rounded-xl border border-line bg-panel/40 p-3 text-left hover:border-line-strong disabled:opacity-50"
						>
							<p class="text-sm font-medium text-primary">{c.name}</p>
							{#if c.address}
								<p class="mt-0.5 text-xs text-secondary">{c.address}</p>
							{/if}
							<p class="mt-1 text-[11px] text-accent/80">
								{saving === c.place_id ? 'Saving…' : 'Use this match'}
							</p>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-xs text-tertiary">Google search is not configured. Paste a Maps URL below.</p>
		{/if}

		<div class="mt-5 border-t border-line pt-4">
			<p class="mb-2 text-[11px] tracking-widest text-tertiary uppercase">
				Paste maps URL
			</p>
			<div class="flex gap-2">
				<input
					type="url"
					bind:value={pasteUrl}
					placeholder="https://maps.app.goo.gl/… or https://maps.apple.com/…"
					class="flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
					autocomplete="off"
					autocorrect="off"
					autocapitalize="off"
					spellcheck="false"
				/>
				<button
					type="button"
					onclick={importUrl}
					disabled={pasting || pasteUrl.trim().length === 0}
					class="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-on-accent disabled:opacity-50"
				>
					{pasting ? '…' : 'Import'}
				</button>
			</div>
		</div>
	</section>
</div>

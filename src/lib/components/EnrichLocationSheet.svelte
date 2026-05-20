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
	class="fixed inset-0 z-40 flex flex-col justify-end bg-slate-950/70"
	role="dialog"
	aria-modal="true"
>
	<button
		type="button"
		class="absolute inset-0 -z-10 h-full w-full cursor-default"
		aria-label="Close"
		onclick={() => onClose?.()}
	></button>
	<section class="max-h-[88vh] overflow-y-auto rounded-t-3xl border-t border-slate-800 bg-slate-900 p-5 pb-8">
		<header class="mb-3 flex items-baseline justify-between gap-2">
			<div>
				<h2 class="text-base font-medium text-slate-100">Add {FIELD_LABEL[missingField]}</h2>
				<p class="text-xs text-slate-500">{restaurantName}</p>
			</div>
			<button type="button" onclick={() => onClose?.()} class="text-xs text-slate-400">Cancel</button>
		</header>

		<p class="mb-2 text-xs text-slate-500">
			Pick a match from Google to fill in any missing details — your existing values won't be
			overwritten.
		</p>

		<div class="flex gap-2">
			<input
				type="text"
				bind:value={query}
				placeholder="Restaurant name + suburb"
				class="flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-orange-600/60 focus:ring-2 focus:ring-orange-600/30 focus:outline-none"
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
				class="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 disabled:opacity-50"
			>
				{searching ? '…' : 'Search'}
			</button>
		</div>

		{#if err}
			<p class="mt-2 text-xs text-red-400">{err}</p>
		{/if}

		<ul class="mt-3 space-y-2">
			{#if searching && candidates.length === 0}
				<li class="text-xs text-slate-500">Searching Google Places…</li>
			{:else if candidates.length === 0 && !err}
				<li class="text-xs text-slate-500">
					No matches yet. Try adjusting the query, or paste a URL below.
				</li>
			{/if}
			{#each candidates as c (c.place_id)}
				<li>
					<button
						type="button"
						onclick={() => pickCandidate(c)}
						disabled={saving !== null}
						class="block w-full rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-left hover:border-slate-700 disabled:opacity-50"
					>
						<p class="text-sm font-medium text-slate-100">{c.name}</p>
						{#if c.address}
							<p class="mt-0.5 text-xs text-slate-400">{c.address}</p>
						{/if}
						<p class="mt-1 text-[11px] text-orange-400/80">
							{saving === c.place_id ? 'Saving…' : 'Use this match'}
						</p>
					</button>
				</li>
			{/each}
		</ul>

		<div class="mt-5 border-t border-slate-800 pt-4">
			<p class="mb-2 text-[11px] tracking-widest text-slate-500 uppercase">
				Or paste a maps URL
			</p>
			<p class="mb-2 text-xs text-slate-500">
				Paste a Google Maps or Apple Maps share URL if you can't find a match above.
			</p>
			<div class="flex gap-2">
				<input
					type="url"
					bind:value={pasteUrl}
					placeholder="https://maps.app.goo.gl/… or https://maps.apple.com/…"
					class="flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-orange-600/60 focus:ring-2 focus:ring-orange-600/30 focus:outline-none"
					autocomplete="off"
					autocorrect="off"
					autocapitalize="off"
					spellcheck="false"
				/>
				<button
					type="button"
					onclick={importUrl}
					disabled={pasting || pasteUrl.trim().length === 0}
					class="rounded-xl bg-orange-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
				>
					{pasting ? '…' : 'Import'}
				</button>
			</div>
		</div>
	</section>
</div>

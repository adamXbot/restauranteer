<script lang="ts">
	import { onMount } from 'svelte';

	type PlacePreview = {
		place_id: string;
		name: string | null;
		address: string | null;
		vault_uuid: string | null;
		loading: boolean;
		error: string | null;
	};

	type Props = {
		initialName: string;
		initialNotes: string | null;
		initialIcon: string | null;
		sourceUrl: string | null;
		placeIds: string[];
		onImported: (result: {
			list_name: string;
			created: number;
			linked: number;
			errors: number;
		}) => void;
		onClose: () => void;
	};

	let {
		initialName,
		initialNotes,
		initialIcon,
		sourceUrl,
		placeIds,
		onImported,
		onClose
	}: Props = $props();

	// svelte-ignore state_referenced_locally
	let listName = $state(initialName);
	// svelte-ignore state_referenced_locally
	let notes = $state(initialNotes ?? '');
	// svelte-ignore state_referenced_locally
	let icon = $state(initialIcon ?? '');

	// svelte-ignore state_referenced_locally
	let previews = $state<PlacePreview[]>(
		placeIds.map((id) => ({
			place_id: id,
			name: null,
			address: null,
			vault_uuid: null,
			loading: true,
			error: null
		}))
	);
	// svelte-ignore state_referenced_locally
	let selected = $state<Set<string>>(new Set(placeIds));

	let importing = $state(false);
	let importError = $state<string | null>(null);

	onMount(() => {
		void Promise.all(
			placeIds.map(async (id, idx) => {
				try {
					const res = await fetch(`/api/places/${encodeURIComponent(id)}`);
					if (!res.ok) {
						previews[idx] = {
							...previews[idx],
							loading: false,
							error: `HTTP ${res.status}`
						};
						return;
					}
					const data = (await res.json()) as {
						place: { name: string; address: string | null };
						vault_uuid: string | null;
					};
					previews[idx] = {
						place_id: id,
						name: data.place.name,
						address: data.place.address,
						vault_uuid: data.vault_uuid,
						loading: false,
						error: null
					};
				} catch (e) {
					previews[idx] = {
						...previews[idx],
						loading: false,
						error: String(e)
					};
				}
			})
		);
	});

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function selectAll() {
		selected = new Set(placeIds);
	}
	function selectNone() {
		selected = new Set();
	}

	async function doImport() {
		const name = listName.trim();
		if (!name) {
			importError = 'List name required';
			return;
		}
		importing = true;
		importError = null;
		try {
			const res = await fetch('/api/import/list', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					list_name: name,
					notes: notes.trim() || null,
					icon: icon.trim() || null,
					source_url: sourceUrl,
					place_ids: Array.from(selected)
				})
			});
			if (!res.ok) {
				importError = await res.text();
				return;
			}
			const result = (await res.json()) as {
				list_name: string;
				created: number;
				linked: number;
				errors: number;
			};
			onImported(result);
		} catch (e) {
			importError = String(e);
		} finally {
			importing = false;
		}
	}

	const selectedCount = $derived(selected.size);
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
		onclick={onClose}
	></button>
	<section
		class="max-h-[90dvh] overflow-y-auto rounded-t-3xl border-t border-slate-800 bg-slate-900 p-5 pb-8"
	>
		<header class="mb-3 flex items-center justify-between">
			<h2 class="text-base font-medium text-slate-100">Import Google Maps list</h2>
			<button type="button" onclick={onClose} class="text-xs text-slate-400">Cancel</button>
		</header>

		<label class="block">
			<span class="text-[10px] tracking-widest text-slate-500 uppercase">List name</span>
			<input
				type="text"
				bind:value={listName}
				class="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
			/>
		</label>

		<label class="mt-3 block">
			<span class="text-[10px] tracking-widest text-slate-500 uppercase">Notes</span>
			<textarea
				bind:value={notes}
				rows="2"
				placeholder="Optional"
				class="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
			></textarea>
		</label>

		<label class="mt-3 block">
			<span class="text-[10px] tracking-widest text-slate-500 uppercase">Icon</span>
			<input
				type="text"
				bind:value={icon}
				placeholder="🌮"
				maxlength="4"
				class="mt-1 w-16 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-center text-xl text-slate-100 placeholder:text-slate-500"
			/>
			<span class="ml-2 text-[11px] text-slate-500">Emoji or short text — shown on the list page.</span>
		</label>

		<div class="mt-4">
			<div class="flex items-center justify-between gap-2">
				<span class="text-[10px] tracking-widest text-slate-500 uppercase">
					Places ({selectedCount} / {placeIds.length} selected)
				</span>
				<div class="flex gap-2 text-[11px] text-slate-400">
					<button
						type="button"
						onclick={selectAll}
						class="underline decoration-slate-700 underline-offset-2"
					>
						All
					</button>
					<button
						type="button"
						onclick={selectNone}
						class="underline decoration-slate-700 underline-offset-2"
					>
						None
					</button>
				</div>
			</div>
			{#if placeIds.length === 0}
				<p class="mt-2 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200">
					No places auto-detected. Google's list pages load place data client-side, so the static
					page often doesn't expose them. The list will be created with just the metadata — add
					places later by pasting their individual Maps URLs.
				</p>
			{:else}
				<ul class="mt-2 space-y-1.5">
					{#each previews as p (p.place_id)}
						{@const isSelected = selected.has(p.place_id)}
						<li>
							<label
								class="flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 {isSelected
									? 'border-orange-700/40 bg-orange-950/20'
									: 'border-slate-800 bg-slate-950/40'}"
							>
								<input
									type="checkbox"
									checked={isSelected}
									onchange={() => toggle(p.place_id)}
									class="mt-1 h-4 w-4"
								/>
								<div class="min-w-0 flex-1">
									{#if p.loading}
										<p class="text-xs text-slate-500">Loading…</p>
									{:else if p.error}
										<p class="text-xs text-amber-400/80">{p.place_id} ({p.error})</p>
									{:else}
										<p class="truncate text-sm text-slate-100">{p.name ?? p.place_id}</p>
										{#if p.address}
											<p class="truncate text-[11px] text-slate-500">{p.address}</p>
										{/if}
										{#if p.vault_uuid}
											<p class="mt-0.5 text-[10px] text-emerald-300/80">★ Already in vault</p>
										{/if}
									{/if}
								</div>
							</label>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if importError}
			<p class="mt-3 text-xs text-red-400">{importError}</p>
		{/if}

		<button
			type="button"
			onclick={doImport}
			disabled={importing || !listName.trim()}
			class="mt-4 w-full rounded-2xl bg-orange-600 px-5 py-3 text-center text-sm font-medium text-white disabled:opacity-50"
		>
			{#if importing}
				Importing…
			{:else if placeIds.length === 0}
				Create empty list
			{:else}
				Import {selectedCount} {selectedCount === 1 ? 'place' : 'places'}
			{/if}
		</button>
	</section>
</div>

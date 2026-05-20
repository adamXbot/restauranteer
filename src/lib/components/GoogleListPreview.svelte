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
	class="fixed inset-0 z-40 flex flex-col justify-end bg-overlay"
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
		class="max-h-[90dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-panel p-5 pb-8"
	>
		<header class="mb-3 flex items-center justify-between">
			<h2 class="text-base font-medium text-primary">Import Google Maps list</h2>
			<button type="button" onclick={onClose} class="text-xs text-secondary">Cancel</button>
		</header>

		<label class="block">
			<span class="text-[10px] tracking-widest text-tertiary uppercase">List name</span>
			<input
				type="text"
				bind:value={listName}
				class="mt-1 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-primary"
			/>
		</label>

		<label class="mt-3 block">
			<span class="text-[10px] tracking-widest text-tertiary uppercase">Notes</span>
			<textarea
				bind:value={notes}
				rows="2"
				placeholder="Optional"
				class="mt-1 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-primary placeholder:text-tertiary"
			></textarea>
		</label>

		<label class="mt-3 block">
			<span class="text-[10px] tracking-widest text-tertiary uppercase">Icon</span>
			<input
				type="text"
				bind:value={icon}
				placeholder="🌮"
				maxlength="4"
				class="mt-1 w-16 rounded-xl border border-line bg-canvas px-3 py-2 text-center text-xl text-primary placeholder:text-tertiary"
			/>
			<span class="ml-2 text-[11px] text-tertiary">Shown on the list.</span>
		</label>

		<div class="mt-4">
			<div class="flex items-center justify-between gap-2">
				<span class="text-[10px] tracking-widest text-tertiary uppercase">
					Places ({selectedCount} / {placeIds.length} selected)
				</span>
				<div class="flex gap-2 text-[11px] text-secondary">
					<button
						type="button"
						onclick={selectAll}
						class="underline decoration-line-strong underline-offset-2"
					>
						All
					</button>
					<button
						type="button"
						onclick={selectNone}
						class="underline decoration-line-strong underline-offset-2"
					>
						None
					</button>
				</div>
			</div>
			{#if placeIds.length === 0}
				<p class="mt-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-xs text-warning">
					No places auto-detected. The list will be created with metadata only.
				</p>
			{:else}
				<ul class="mt-2 space-y-1.5">
					{#each previews as p (p.place_id)}
						{@const isSelected = selected.has(p.place_id)}
						<li>
							<label
								class="flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 {isSelected
									? 'border-accent/40 bg-accent-soft/40'
									: 'border-line bg-canvas/40'}"
							>
								<input
									type="checkbox"
									checked={isSelected}
									onchange={() => toggle(p.place_id)}
									class="mt-1 h-4 w-4"
								/>
								<div class="min-w-0 flex-1">
									{#if p.loading}
										<p class="text-xs text-tertiary">Loading…</p>
									{:else if p.error}
										<p class="text-xs text-warning/80">{p.place_id} ({p.error})</p>
									{:else}
										<p class="truncate text-sm text-primary">{p.name ?? p.place_id}</p>
										{#if p.address}
											<p class="truncate text-[11px] text-tertiary">{p.address}</p>
										{/if}
										{#if p.vault_uuid}
											<p class="mt-0.5 text-[10px] text-success/80">★ Already in vault</p>
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
			<p class="mt-3 text-xs text-danger">{importError}</p>
		{/if}

		<button
			type="button"
			onclick={doImport}
			disabled={importing || !listName.trim()}
			class="mt-4 w-full rounded-2xl bg-accent px-5 py-3 text-center text-sm font-medium text-on-accent disabled:opacity-50"
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

<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import BackLink from '$lib/components/BackLink.svelte';

	let { data }: { data: PageData } = $props();

	type Field = (typeof data.fields)[number];

	const FIELD_LABELS: Record<Field, string> = {
		name: 'Name',
		address: 'Address',
		suburb: 'Suburb',
		phone: 'Phone',
		website: 'Website',
		lat: 'Latitude',
		lng: 'Longitude',
		cuisine: 'Cuisine'
	};

	function formatValue(v: unknown): string {
		if (v === null || v === undefined) return '— not provided —';
		if (Array.isArray(v)) return v.length === 0 ? '— empty —' : v.join(', ');
		if (typeof v === 'number') return String(v);
		const s = String(v).trim();
		return s.length === 0 ? '— empty —' : s;
	}

	function fieldDiffersAcrossSources(field: Field): boolean {
		const values = data.sources.map((s) => JSON.stringify(s.values[field] ?? null));
		return new Set(values).size > 1;
	}

	const fieldsWithDiffs = $derived(data.fields.filter((f) => fieldDiffersAcrossSources(f)));
	const fieldsInAgreement = $derived(data.fields.filter((f) => !fieldDiffersAcrossSources(f)));

	// Default: keep current for each field
	function buildInitialSelections(): Partial<Record<Field, string>> {
		const init: Partial<Record<Field, string>> = {};
		for (const f of data.fields) init[f] = 'current';
		return init;
	}
	// svelte-ignore state_referenced_locally
	let selections = $state<Partial<Record<Field, string>>>(buildInitialSelections());

	let saving = $state(false);
	let saveMsg = $state<string | null>(null);
	let saveError = $state<string | null>(null);

	function pick(field: Field, sourceId: string) {
		selections = { ...selections, [field]: sourceId };
	}

	const changedFields = $derived(fieldsWithDiffs.filter((f) => selections[f] && selections[f] !== 'current'));

	async function save() {
		saving = true;
		saveError = null;
		saveMsg = null;
		try {
			const res = await fetch(`/api/restaurants/${data.uuid}/compare`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ selections })
			});
			if (!res.ok) {
				saveError = await res.text();
				saving = false;
				return;
			}
			const { updated } = (await res.json()) as { updated: string[] };
			saveMsg = updated.length > 0 ? `Updated ${updated.length} field${updated.length === 1 ? '' : 's'}` : 'No changes';
			setTimeout(() => goto(`/restaurant/${data.uuid}`), 600);
		} catch (e) {
			saveError = String(e);
			saving = false;
		}
	}
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href={`/restaurant/${data.uuid}`} />
	<h1 class="mt-2 text-2xl font-semibold text-primary">Compare info</h1>
	<p class="mt-1 text-sm text-secondary">{data.name}</p>
	<p class="mt-2 text-[11px] text-tertiary">
		Pick the canonical value for each field where sources disagree. The vault file is updated only
		when you tap Save.
	</p>
</header>

{#if data.sources.length < 2}
	<section class="mx-5 mt-4 rounded-xl border border-line bg-panel/50 p-4 text-sm text-secondary">
		Nothing to compare against yet — link a Google Maps or article URL to this restaurant from the
		detail page, then come back.
	</section>
{:else if fieldsWithDiffs.length === 0}
	<section class="mx-5 mt-4 rounded-xl border border-success/50 bg-success/10 p-4 text-sm text-success">
		All sources agree on every field. Nothing to choose between.
	</section>
{:else}
	<section class="px-5 pt-4 pb-2 space-y-4">
		{#each fieldsWithDiffs as field (field)}
			<div class="rounded-2xl border border-line bg-panel/40 p-3">
				<p class="text-xs tracking-widest text-tertiary uppercase">{FIELD_LABELS[field]}</p>
				<ul class="mt-2 space-y-1.5">
					{#each data.sources as source (source.id)}
						{@const value = source.values[field]}
						{@const isSelected = selections[field] === source.id}
						<li>
							<button
								type="button"
								onclick={() => pick(field, source.id)}
								class={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${isSelected ? 'border-accent bg-accent-soft/40' : 'border-line bg-panel'}`}
							>
								<span
									class="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2"
									class:border-accent={isSelected}
									class:bg-accent={isSelected}
									class:border-line-strong={!isSelected}
								>
									{#if isSelected}
										<span class="block h-1.5 w-1.5 rounded-full bg-white"></span>
									{/if}
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline gap-2">
										<span class="text-[11px] tracking-widest text-secondary uppercase"
											>{source.label}</span
										>
										{#if source.id === 'current'}
											<span class="text-[10px] text-tertiary">(in vault)</span>
										{/if}
									</div>
									<p
										class="mt-0.5 text-sm break-words text-primary"
										class:text-tertiary={value === null || value === undefined}
									>
										{formatValue(value)}
									</p>
								</div>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</section>

	{#if fieldsInAgreement.length > 0}
		<section class="mx-5 mt-4 rounded-xl border border-line bg-panel/40 p-3 text-xs text-tertiary">
			<p class="text-[10px] tracking-widest text-tertiary uppercase">All sources agree</p>
			<p class="mt-1 text-secondary">
				{fieldsInAgreement.map((f) => FIELD_LABELS[f]).join(' · ')}
			</p>
		</section>
	{/if}

	{#if saveMsg}
		<p class="mx-5 mt-3 rounded-xl border border-success/50 bg-success/10 px-3 py-2 text-xs text-success">
			{saveMsg}
		</p>
	{/if}
	{#if saveError}
		<p class="mx-5 mt-3 rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-xs text-danger">
			{saveError}
		</p>
	{/if}

	<div class="px-5 pt-4 pb-8">
		<button
			type="button"
			onclick={save}
			disabled={saving || changedFields.length === 0}
			class="w-full rounded-2xl bg-accent px-5 py-3 text-center text-sm font-medium text-on-accent disabled:opacity-50"
		>
			{#if saving}
				Saving…
			{:else if changedFields.length === 0}
				Pick a different source on a field to enable Save
			{:else}
				Save {changedFields.length} change{changedFields.length === 1 ? '' : 's'}
			{/if}
		</button>
	</div>
{/if}

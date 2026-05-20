<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import BackLink from '$lib/components/BackLink.svelte';
	import CopyMarkdownButton from '$lib/components/CopyMarkdownButton.svelte';

	let { data }: { data: PageData } = $props();

	async function fetchBundle(): Promise<string> {
		const res = await fetch(`/api/lists/${encodeURIComponent(data.name)}/bundle`);
		if (!res.ok) throw new Error(`Failed to bundle list (${res.status})`);
		return await res.text();
	}

	type AddResult = { url: string; status: 'added' | 'skipped' | 'error'; reason?: string };

	let showAdd = $state(false);
	let pasteText = $state('');
	let adding = $state(false);
	let addResults = $state<AddResult[]>([]);

	async function importUrls() {
		const urls = pasteText
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter((s) => /^https?:\/\//i.test(s));
		if (urls.length === 0) return;

		adding = true;
		addResults = [];
		try {
			for (const url of urls) {
				try {
					const res = await fetch('/api/import', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ url, add_to_list: data.name, force_new: true })
					});
					if (!res.ok) {
						addResults = [
							...addResults,
							{ url, status: 'error', reason: (await res.text()) || `HTTP ${res.status}` }
						];
						continue;
					}
					const body = (await res.json()) as { type: string };
					if (body.type === 'candidates') {
						addResults = [
							...addResults,
							{ url, status: 'skipped', reason: 'Multiple vault matches — add manually' }
						];
					} else if (body.type === 'list_preview') {
						addResults = [
							...addResults,
							{ url, status: 'skipped', reason: 'Looks like a list URL, not a single place' }
						];
					} else {
						addResults = [...addResults, { url, status: 'added' }];
					}
				} catch (e) {
					addResults = [
						...addResults,
						{ url, status: 'error', reason: String(e instanceof Error ? e.message : e) }
					];
				}
			}
			if (addResults.some((r) => r.status === 'added')) {
				pasteText = '';
				await invalidateAll();
			}
		} finally {
			adding = false;
		}
	}
</script>

<header class="px-5 pt-6 pb-3">
	<BackLink href="/lists" label="All lists" />
	<div class="mt-2 flex items-start justify-between gap-3">
		<h1 class="text-2xl font-semibold text-primary">
			{#if data.meta?.icon}<span class="mr-1">{data.meta.icon}</span>{/if}{data.name}
		</h1>
		<CopyMarkdownButton
			text={null}
			fetch={fetchBundle}
			title={`${data.name} (restauranteer list)`}
			label="Copy markdown"
		/>
	</div>
	<p class="mt-1 text-sm text-secondary">
		{data.restaurants.length}
		{data.restaurants.length === 1 ? 'restaurant' : 'restaurants'}
	</p>
	{#if data.meta?.notes}
		<p class="mt-2 text-sm text-secondary">{data.meta.notes}</p>
	{/if}
	{#if data.meta?.source_url}
		<a
			href={data.meta.source_url}
			target="_blank"
			rel="noopener noreferrer"
			class="mt-1 inline-block text-[11px] text-tertiary underline decoration-line-strong underline-offset-2"
		>
			Imported from Google Maps ↗
		</a>
	{/if}
</header>

<section class="px-5">
	<button
		type="button"
		onclick={() => (showAdd = !showAdd)}
		class="w-full rounded-xl border border-dashed border-line-strong bg-panel/30 px-3 py-2 text-xs text-secondary hover:border-accent/60 hover:text-accent"
	>
		{showAdd ? '− Hide add places' : '+ Add places by URL'}
	</button>
	{#if showAdd}
		<div class="mt-2 rounded-2xl border border-line bg-panel/40 p-3">
			<p class="text-[11px] text-tertiary">
				Paste Google Maps, Apple Maps, or Broadsheet / Good Food / Time Out URLs — one per line.
				Each resolves to a restaurant and gets added to this list.
			</p>
			<textarea
				bind:value={pasteText}
				rows="4"
				placeholder="https://maps.app.goo.gl/…&#10;https://maps.apple.com/…&#10;https://www.broadsheet.com.au/…"
				class="mt-2 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
			></textarea>
			<button
				type="button"
				onclick={importUrls}
				disabled={adding || pasteText.trim().length === 0}
				class="mt-2 w-full rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
			>
				{adding ? 'Adding…' : 'Add to list'}
			</button>
			{#if addResults.length > 0}
				<ul class="mt-3 space-y-1 text-[11px]">
					{#each addResults as r (r.url)}
						<li class="flex gap-2">
							<span
								class="shrink-0"
								class:text-success={r.status === 'added'}
								class:text-warning={r.status === 'skipped'}
								class:text-danger={r.status === 'error'}
							>
								{r.status === 'added' ? '✓' : r.status === 'skipped' ? '·' : '✕'}
							</span>
							<span class="min-w-0 flex-1 break-all text-secondary">
								{r.url}{#if r.reason}<span class="text-tertiary"> — {r.reason}</span>{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</section>

<section class="grid gap-3 px-5 pt-3 pb-10">
	{#if data.restaurants.length === 0}
		<div class="rounded-2xl border border-dashed border-line-strong bg-panel/30 p-6">
			<h2 class="text-base font-medium text-primary">No restaurants yet</h2>
			<p class="mt-1 text-sm text-secondary">Add this list from a restaurant's Organise section.</p>
			<a
				href="/"
				class="mt-4 inline-flex rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent"
			>
				Find restaurant
			</a>
		</div>
	{:else}
		{#each data.restaurants as r (r.uuid)}
			<a
				href={`/restaurant/${r.uuid}`}
				class="block min-w-0 rounded-2xl border border-line bg-panel/50 p-4"
			>
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0 flex-1">
						<h2 class="truncate text-base font-medium text-primary">{r.name}</h2>
						{#if r.suburb || r.address}
							<p class="mt-0.5 truncate text-xs text-secondary">{r.suburb ?? r.address}</p>
						{/if}
						{#if r.listNote}
							<p class="mt-2 line-clamp-2 text-xs text-secondary">{r.listNote}</p>
						{/if}
					</div>
					{#if r.rating != null}
						<span class="shrink-0 text-sm text-rating">★ {r.rating}</span>
					{/if}
				</div>
			</a>
		{/each}
	{/if}
</section>

<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import BackLink from '$lib/components/BackLink.svelte';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let creatingList = $state(data.create);
	let newListName = $state('');
	let createError = $state<string | null>(null);
	let saving = $state(false);

	function openCreate() {
		creatingList = true;
		createError = null;
	}

	async function createList(event: SubmitEvent) {
		event.preventDefault();
		const name = newListName.trim();
		if (!name) {
			createError = 'Enter a list name';
			return;
		}
		saving = true;
		createError = null;
		try {
			const res = await fetch('/api/lists', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			});
			const body = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
			if (!res.ok) throw new Error(body.message ?? 'Could not create list');
			await invalidateAll();
			await goto(`/lists/${encodeURIComponent(body.name ?? name)}`);
		} catch (err) {
			createError = err instanceof Error ? err.message : 'Could not create list';
		} finally {
			saving = false;
		}
	}
</script>

<header class="px-5 pt-6 pb-3">
	<BackLink href="/" />
	<div class="mt-2 flex items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold text-primary">Lists</h1>
			<p class="mt-1 text-sm text-secondary">
				{data.lists.length}
				{data.lists.length === 1 ? 'list' : 'lists'}
			</p>
		</div>
		<button
			type="button"
			onclick={openCreate}
			class="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent"
		>
			New list
		</button>
	</div>
</header>

{#if creatingList}
	<section class="px-5 pb-3">
		<form
			onsubmit={createList}
			class="rounded-2xl border border-line bg-panel/60 p-3"
		>
			<label for="new-list-name" class="sr-only">List name</label>
			<div class="flex gap-2">
				<input
					id="new-list-name"
					bind:value={newListName}
					maxlength="60"
					placeholder="List name"
					class="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-primary outline-none placeholder:text-tertiary"
					disabled={saving}
				/>
				<button
					type="submit"
					class="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
					disabled={saving}
				>
					{saving ? 'Creating' : 'Create'}
				</button>
			</div>
			{#if createError}
				<p class="mt-2 text-xs text-danger">{createError}</p>
			{/if}
		</form>
	</section>
{/if}

{#if data.lists.length === 0}
	<section class="px-5 pb-10">
		<div class="rounded-2xl border border-dashed border-line-strong bg-panel/30 p-6">
			<h2 class="text-base font-medium text-primary">No lists yet</h2>
			<p class="mt-1 text-sm text-secondary">Create one to group restaurants.</p>
			{#if !creatingList}
				<button
					type="button"
					onclick={openCreate}
					class="mt-4 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent"
				>
					Create list
				</button>
			{/if}
		</div>
	</section>
{:else}
	<section class="grid grid-cols-2 gap-3 px-5 pb-10">
		{#each data.lists as l (l.name)}
			<a
				href={`/lists/${encodeURIComponent(l.name)}`}
				class="flex h-28 flex-col justify-between rounded-2xl border border-line bg-panel/60 p-4"
			>
				<h2 class="line-clamp-2 text-sm font-medium text-primary">{l.name}</h2>
				<p class="text-xs text-tertiary">
					{l.count}
					{l.count === 1 ? 'restaurant' : 'restaurants'}
				</p>
			</a>
		{/each}
	</section>
{/if}

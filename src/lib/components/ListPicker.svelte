<script lang="ts">
	type ListMembership = {
		list: string;
		notes?: string | null;
	};

	type Props = {
		restaurantUuid: string;
		currentLists: string[];
		availableLists: string[];
		currentMemberships?: ListMembership[];
		onSaved?: (lists: string[]) => void;
		onClose?: () => void;
	};

	let {
		restaurantUuid,
		currentLists,
		availableLists,
		currentMemberships = [],
		onSaved,
		onClose
	}: Props = $props();

	// Snapshot at mount time — modal opens with a frozen view the user can edit
	// svelte-ignore state_referenced_locally
	const initialSet = new Set<string>(currentLists);
	// svelte-ignore state_referenced_locally
	const initialNotes = Object.fromEntries(
		currentMemberships
			.filter((m) => currentLists.includes(m.list) && typeof m.notes === 'string')
			.map((m) => [m.list, m.notes ?? ''])
	);
	// svelte-ignore state_referenced_locally
	let selected = $state(new Set<string>(currentLists));
	// svelte-ignore state_referenced_locally
	let notesByList = $state<Record<string, string>>(initialNotes);
	// Merged list shown in the UI: every existing list, every currently-selected
	// list, AND anything the user has just added but not yet saved.
	let merged = $derived.by(() => {
		const set = new Set<string>(availableLists);
		for (const l of currentLists) set.add(l);
		for (const l of selected) set.add(l);
		return [...set].sort((a, b) => a.localeCompare(b));
	});
	let newName = $state('');
	let saving = $state(false);
	let err = $state<string | null>(null);

	function toggle(name: string) {
		const next = new Set(selected);
		if (next.has(name)) next.delete(name);
		else {
			next.add(name);
			if (notesByList[name] === undefined) notesByList = { ...notesByList, [name]: '' };
		}
		selected = next;
	}

	function setNote(name: string, value: string) {
		notesByList = { ...notesByList, [name]: value };
	}

	function flushInput(): boolean {
		const name = newName.trim();
		if (!name) return false;
		const next = new Set(selected);
		next.add(name);
		selected = next;
		if (notesByList[name] === undefined) notesByList = { ...notesByList, [name]: '' };
		newName = '';
		return true;
	}

	async function save() {
		// Implicit "Add" so users don't have to think about clicking Add first
		flushInput();
		saving = true;
		err = null;
		try {
			const lists = [...selected].sort((a, b) => a.localeCompare(b));
			const list_memberships = lists.map((list) => ({
				list,
				notes: (notesByList[list] ?? '').trim()
			}));
			const res = await fetch(`/api/restaurants/${restaurantUuid}/lists`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ lists, list_memberships })
			});
			if (!res.ok) {
				err = `Failed: ${res.status}`;
				saving = false;
				return;
			}
			const data = (await res.json()) as { lists: string[] };
			onSaved?.(data.lists);
		} catch (e) {
			err = String(e);
			saving = false;
		}
	}

	function cancel() {
		selected = new Set(initialSet);
		notesByList = initialNotes;
		onClose?.();
	}
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
		onclick={cancel}
	></button>
	<section class="rounded-t-3xl border-t border-line bg-panel p-5 pb-8">
		<header class="mb-3 flex items-center justify-between">
			<h2 class="text-base font-medium text-primary">Lists</h2>
			<button type="button" onclick={cancel} class="text-xs text-secondary">Cancel</button>
		</header>

		<ul class="max-h-[55vh] space-y-2 overflow-y-auto">
			{#each merged as name (name)}
				{@const noteId = `list-note-${encodeURIComponent(name)}`}
				<li>
					<div class="rounded-xl border border-line bg-panel/40 p-2.5">
						<button
							type="button"
							onclick={() => toggle(name)}
							class="flex w-full items-center justify-between gap-3 text-left"
						>
							<span class="min-w-0 truncate text-sm text-primary">{name}</span>
							<span
								class="shrink-0 rounded-full px-2 py-0.5 text-xs"
								class:bg-accent={selected.has(name)}
								class:text-on-accent={selected.has(name)}
								class:bg-panel-2={!selected.has(name)}
								class:text-secondary={!selected.has(name)}
							>
								{selected.has(name) ? 'in' : 'out'}
							</span>
						</button>
						{#if selected.has(name)}
							<label for={noteId} class="sr-only">Why {name}</label>
							<textarea
								id={noteId}
								value={notesByList[name] ?? ''}
								rows="2"
								placeholder="Why on this list?"
								class="mt-2 w-full resize-none rounded-lg border border-line bg-panel px-2.5 py-2 text-xs text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
								oninput={(e) => setNote(name, e.currentTarget.value)}
							></textarea>
						{/if}
					</div>
				</li>
			{/each}
			{#if merged.length === 0}
				<li class="rounded-xl border border-dashed border-line px-3 py-3 text-xs text-tertiary">
					No lists yet.
				</li>
			{/if}
		</ul>

		<div class="mt-3 flex gap-2">
			<input
				type="text"
				bind:value={newName}
				placeholder="New list"
				maxlength="60"
				class="flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						flushInput();
					}
				}}
			/>
			<button
				type="button"
				onclick={flushInput}
				disabled={newName.trim().length === 0}
				class="rounded-xl border border-line bg-panel-2 px-3 text-sm text-primary disabled:opacity-50"
			>
				+ Add
			</button>
		</div>

		{#if err}
			<p class="mt-2 text-xs text-danger">{err}</p>
		{/if}

		<button
			type="button"
			onclick={save}
			disabled={saving}
			class="mt-4 w-full rounded-2xl bg-accent px-5 py-3 text-center text-sm font-medium text-on-accent disabled:opacity-50"
		>
			{saving ? 'Saving…' : 'Save'}
		</button>
	</section>
</div>

<script lang="ts">
	import { ATTRIBUTE_LIMITS, type AttributeDefinition, type AttributeScope } from '$lib/attributes';

	type Props = {
		// undefined means "new"; pass an existing definition to edit it.
		definition?: AttributeDefinition;
		availableTags: string[];
		availableCuisines: string[];
		availableLists: string[];
		onSave: (def: AttributeDefinition) => void;
		onDelete?: () => void;
		onClose: () => void;
	};

	let {
		definition,
		availableTags,
		availableCuisines,
		availableLists,
		onSave,
		onDelete,
		onClose
	}: Props = $props();

	/* svelte-ignore state_referenced_locally */
	const editing = definition !== undefined;

	// Initial snapshot — the sheet opens with a frozen view the user can edit.
	/* svelte-ignore state_referenced_locally */
	let label = $state(definition?.label ?? '');
	/* svelte-ignore state_referenced_locally */
	let description = $state(definition?.description ?? '');
	/* svelte-ignore state_referenced_locally */
	let tags = $state<string[]>([...(definition?.scope.tags ?? [])]);
	/* svelte-ignore state_referenced_locally */
	let cuisines = $state<string[]>([...(definition?.scope.cuisines ?? [])]);
	/* svelte-ignore state_referenced_locally */
	let lists = $state<string[]>([...(definition?.scope.lists ?? [])]);
	let extraTag = $state('');

	function toggleIn(arr: string[], v: string): string[] {
		const lower = v.toLowerCase();
		const has = arr.some((x) => x.toLowerCase() === lower);
		return has ? arr.filter((x) => x.toLowerCase() !== lower) : [...arr, v];
	}

	function addExtraTag() {
		const t = extraTag.trim().replace(/^#/, '');
		if (!t) return;
		if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
			tags = [...tags, t];
		}
		extraTag = '';
	}

	function save() {
		const trimmedLabel = label.trim();
		if (!trimmedLabel) return;
		const scope: AttributeScope = {};
		if (tags.length > 0) scope.tags = tags;
		if (cuisines.length > 0) scope.cuisines = cuisines;
		if (lists.length > 0) scope.lists = lists;
		const next: AttributeDefinition = {
			id: definition?.id ?? '', // server / coercer assigns a fresh id when empty
			label: trimmedLabel,
			scope
		};
		const desc = description.trim();
		if (desc) next.description = desc;
		onSave(next);
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
		onclick={onClose}
	></button>
	<section class="max-h-[90vh] overflow-y-auto rounded-t-3xl border-t border-line bg-panel p-5 pb-8">
		<header class="mb-3 flex items-center justify-between">
			<h2 class="text-base font-medium text-primary">
				{editing ? 'Edit attribute' : 'New attribute'}
			</h2>
			<button type="button" onclick={onClose} class="text-xs text-secondary">Cancel</button>
		</header>

		<label class="flex flex-col gap-1">
			<span class="text-xs text-secondary">Label</span>
			<input
				type="text"
				bind:value={label}
				maxlength={ATTRIBUTE_LIMITS.MAX_LABEL_LEN}
				placeholder="Pay by card"
				class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
			/>
		</label>

		<label class="mt-3 flex flex-col gap-1">
			<span class="text-xs text-secondary">Description (optional)</span>
			<input
				type="text"
				bind:value={description}
				maxlength={ATTRIBUTE_LIMITS.MAX_DESC_LEN}
				placeholder="Helper text shown under the label"
				class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
			/>
		</label>

		<section class="mt-4">
			<p class="text-xs tracking-widest text-tertiary uppercase">Applies to</p>
			<p class="mt-1 text-[11px] text-tertiary">
				Leave all empty to apply to every restaurant. Within each list it's OR; across lists it's AND.
			</p>

			{#if availableTags.length > 0}
				<div class="mt-3">
					<p class="text-xs text-secondary">Tags</p>
					<div class="mt-1 flex flex-wrap gap-1">
						{#each availableTags as t (t)}
							{@const active = tags.some((x) => x.toLowerCase() === t.toLowerCase())}
							<button
								type="button"
								onclick={() => (tags = toggleIn(tags, t))}
								class="rounded-full px-2 py-0.5 text-xs"
								class:bg-accent={active}
								class:text-on-accent={active}
								class:bg-panel-2={!active}
								class:text-secondary={!active}
							>
								#{t}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<div class="mt-3 flex gap-2">
				<input
					type="text"
					bind:value={extraTag}
					placeholder="Add tag (not in list)"
					maxlength="40"
					class="flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-xs text-primary placeholder:text-tertiary"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							addExtraTag();
						}
					}}
				/>
				<button
					type="button"
					onclick={addExtraTag}
					disabled={extraTag.trim().length === 0}
					class="rounded-xl border border-line bg-panel-2 px-3 text-xs text-primary disabled:opacity-50"
				>
					+ Add
				</button>
			</div>
			{#if tags.length > 0}
				<div class="mt-2 flex flex-wrap gap-1">
					{#each tags as t (t)}
						<button
							type="button"
							onclick={() => (tags = tags.filter((x) => x !== t))}
							class="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent"
						>
							<span>#{t}</span>
							<span aria-hidden="true">×</span>
						</button>
					{/each}
				</div>
			{/if}

			{#if availableCuisines.length > 0}
				<div class="mt-4">
					<p class="text-xs text-secondary">Cuisines</p>
					<div class="mt-1 flex flex-wrap gap-1">
						{#each availableCuisines as c (c)}
							{@const active = cuisines.some((x) => x.toLowerCase() === c.toLowerCase())}
							<button
								type="button"
								onclick={() => (cuisines = toggleIn(cuisines, c))}
								class="rounded-full px-2 py-0.5 text-xs"
								class:bg-accent={active}
								class:text-on-accent={active}
								class:bg-panel-2={!active}
								class:text-secondary={!active}
							>
								{c}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#if availableLists.length > 0}
				<div class="mt-4">
					<p class="text-xs text-secondary">Lists</p>
					<div class="mt-1 flex flex-wrap gap-1">
						{#each availableLists as l (l)}
							{@const active = lists.some((x) => x.toLowerCase() === l.toLowerCase())}
							<button
								type="button"
								onclick={() => (lists = toggleIn(lists, l))}
								class="rounded-full px-2 py-0.5 text-xs"
								class:bg-accent={active}
								class:text-on-accent={active}
								class:bg-panel-2={!active}
								class:text-secondary={!active}
							>
								{l}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</section>

		<div class="mt-5 grid grid-cols-2 gap-2">
			<button
				type="button"
				onclick={save}
				disabled={label.trim().length === 0}
				class="rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-on-accent disabled:opacity-50"
			>
				{editing ? 'Save' : 'Add'}
			</button>
			{#if editing && onDelete}
				<button
					type="button"
					onclick={onDelete}
					class="rounded-2xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger"
				>
					Delete
				</button>
			{:else}
				<button
					type="button"
					onclick={onClose}
					class="rounded-2xl border border-line-strong bg-panel-2 px-4 py-3 text-sm text-secondary"
				>
					Cancel
				</button>
			{/if}
		</div>
	</section>
</div>

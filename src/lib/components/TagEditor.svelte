<script lang="ts">
	type Props = {
		restaurantUuid: string;
		currentTags: string[];
		onSaved?: (tags: string[]) => void;
		onClose?: () => void;
	};

	let { restaurantUuid, currentTags, onSaved, onClose }: Props = $props();

	// Snapshot at mount time — modal opens with a frozen view the user can edit
	// svelte-ignore state_referenced_locally
	let tags = $state<string[]>([...currentTags]);
	let input = $state('');
	let saving = $state(false);
	let err = $state<string | null>(null);

	function flushInput(): boolean {
		const t = input.trim().replace(/^#/, '');
		if (!t) return false;
		if (tags.some((existing) => existing.toLowerCase() === t.toLowerCase())) {
			input = '';
			return false;
		}
		tags = [...tags, t];
		input = '';
		return true;
	}

	function remove(t: string) {
		tags = tags.filter((x) => x !== t);
	}

	async function save() {
		// Implicit "Add" so a user who just typed a tag and hits Save still gets it
		flushInput();
		saving = true;
		err = null;
		try {
			const res = await fetch(`/api/restaurants/${restaurantUuid}/tags`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tags })
			});
			if (!res.ok) {
				err = `Failed: ${res.status}`;
				saving = false;
				return;
			}
			const data = (await res.json()) as { tags: string[] };
			onSaved?.(data.tags);
		} catch (e) {
			err = String(e);
			saving = false;
		}
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
		onclick={() => onClose?.()}
	></button>
	<section class="rounded-t-3xl border-t border-line bg-panel p-5 pb-8">
		<header class="mb-3 flex items-center justify-between">
			<h2 class="text-base font-medium text-primary">Tags</h2>
			<button type="button" onclick={() => onClose?.()} class="text-xs text-secondary">Cancel</button
			>
		</header>

		<div class="flex flex-wrap gap-1">
			{#each tags as t (t)}
				<button
					type="button"
					onclick={() => remove(t)}
					class="flex items-center gap-1.5 rounded-full bg-panel-2 px-2.5 py-1 text-xs text-secondary"
				>
					<span>#{t}</span>
					<span aria-hidden="true" class="text-tertiary">×</span>
				</button>
			{/each}
			{#if tags.length === 0}
				<p class="text-xs text-tertiary">No tags yet.</p>
			{/if}
		</div>

		<div class="mt-3 flex gap-2">
			<input
				type="text"
				bind:value={input}
				placeholder="Add tag — typing then Save is enough"
				maxlength="40"
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
				disabled={input.trim().length === 0}
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

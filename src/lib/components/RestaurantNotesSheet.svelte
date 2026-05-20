<script lang="ts">
	type Props = {
		restaurantUuid: string;
		currentNotes: string;
		onSaved?: (notes: string) => void;
		onClose?: () => void;
	};

	let { restaurantUuid, currentNotes, onSaved, onClose }: Props = $props();

	// svelte-ignore state_referenced_locally
	let notes = $state(currentNotes);
	let saving = $state(false);
	let err = $state<string | null>(null);

	async function save() {
		saving = true;
		err = null;
		try {
			const res = await fetch(`/api/restaurants/${restaurantUuid}/notes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notes })
			});
			if (!res.ok) {
				err = (await res.text()) || `Failed: ${res.status}`;
				saving = false;
				return;
			}
			const data = (await res.json()) as { notes: string };
			onSaved?.(data.notes);
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
			<h2 class="text-base font-medium text-primary">Notes</h2>
			<button type="button" onclick={() => onClose?.()} class="text-xs text-secondary">Cancel</button>
		</header>

		<!-- svelte-ignore a11y_autofocus — modal sheet starts at the editing field -->
		<textarea
			bind:value={notes}
			autofocus
			rows="8"
			placeholder="Add a comment"
			class="w-full resize-none rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
		></textarea>

		{#if err}
			<p class="mt-2 text-xs text-danger">{err}</p>
		{/if}

		<button
			type="button"
			onclick={save}
			disabled={saving}
			class="mt-4 w-full rounded-2xl bg-accent px-5 py-3 text-center text-sm font-medium text-on-accent disabled:opacity-50"
		>
			{saving ? 'Saving...' : 'Save'}
		</button>
	</section>
</div>

<script lang="ts">
	type Props = {
		restaurantUuid: string;
		onSaved?: () => void;
		onClose?: () => void;
	};
	let { restaurantUuid, onSaved, onClose }: Props = $props();

	let url = $state('');
	let busy = $state(false);
	let err = $state<string | null>(null);

	async function save() {
		busy = true;
		err = null;
		try {
			// /api/import handles any URL we recognise and respects link_to_uuid —
			// adds the article to this restaurant for article URLs, or merges Google
			// Place data into this restaurant for Google Maps URLs.
			const res = await fetch('/api/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: url.trim(), link_to_uuid: restaurantUuid })
			});
			if (!res.ok) {
				err = await res.text();
				busy = false;
				return;
			}
			onSaved?.();
		} catch (e) {
			err = String(e);
			busy = false;
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
			<h2 class="text-base font-medium text-primary">Link URL</h2>
			<button type="button" onclick={() => onClose?.()} class="text-xs text-secondary">Cancel</button>
		</header>

		<input
			type="url"
			bind:value={url}
			placeholder="https://…"
			class="w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
			autocomplete="off"
			autocorrect="off"
			autocapitalize="off"
			spellcheck="false"
		/>

		{#if err}
			<p class="mt-2 text-xs text-danger">{err}</p>
		{/if}

		<button
			type="button"
			onclick={save}
			disabled={busy || url.trim().length === 0}
			class="mt-4 w-full rounded-2xl bg-accent px-5 py-3 text-center text-sm font-medium text-on-accent disabled:opacity-50"
		>
			{busy ? 'Linking…' : 'Link'}
		</button>
	</section>
</div>

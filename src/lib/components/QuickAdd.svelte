<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	let { open = $bindable(false) }: { open?: boolean } = $props();
	let url = $state('');
	let busy = $state(false);
	let err = $state<string | null>(null);

	function close() {
		open = false;
		err = null;
	}

	function go(href: string) {
		close();
		void goto(href);
	}

	async function saveUrl() {
		const trimmed = url.trim();
		if (!trimmed) return;
		busy = true;
		err = null;
		try {
			const res = await fetch('/api/inbox', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: trimmed })
			});
			if (!res.ok) {
				err = (await res.text()) || `Failed: ${res.status}`;
				return;
			}
			const result = (await res.json()) as
				| { status: 'added' | 'already_pending'; item: { id: number } }
				| { status: 'already_attached'; uuid: string };
			url = '';
			await invalidateAll();
			close();
			if (result.status === 'already_attached') {
				await goto(`/restaurant/${result.uuid}`);
			} else {
				await goto('/inbox');
			}
		} catch (e) {
			err = String(e instanceof Error ? e.message : e);
		} finally {
			busy = false;
		}
	}
</script>

<button
	type="button"
	aria-label="Quick add"
	title="Quick add"
	onclick={() => (open = true)}
	class="fixed right-5 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-2xl leading-none font-medium text-on-accent shadow-xl shadow-accent/25 lg:hidden"
>
	+
</button>

{#if open}
	<button
		type="button"
		class="fixed inset-0 z-40 bg-overlay"
		aria-label="Close quick add"
		onclick={close}
	></button>
	<section
		class="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-panel p-5 pb-[calc(2rem+env(safe-area-inset-bottom))] shadow-xl"
		role="dialog"
		aria-modal="true"
	>
		<header class="mb-3 flex items-center justify-between gap-3">
			<h2 class="text-base font-medium text-primary">Quick add</h2>
			<button type="button" onclick={close} class="text-xs text-secondary">Cancel</button>
		</header>

		<div class="flex gap-2">
			<input
				type="url"
				bind:value={url}
				placeholder="Paste URL"
				class="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
				autocomplete="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				onkeydown={(e) => {
					if (e.key === 'Enter') void saveUrl();
				}}
			/>
			<button
				type="button"
				onclick={saveUrl}
				disabled={busy || url.trim().length === 0}
				class="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
			>
				{busy ? 'Saving' : 'Save'}
			</button>
		</div>
		{#if err}
			<p class="mt-2 text-xs text-danger">{err}</p>
		{/if}

		<div class="mt-4 grid grid-cols-2 gap-2">
			<button
				type="button"
				onclick={() => go('/')}
				class="rounded-2xl border border-line bg-panel/60 p-3 text-left"
			>
				<span class="block text-sm font-medium text-primary">Search</span>
				<span class="mt-0.5 block text-xs text-tertiary">Vault + Google</span>
			</button>
			<button
				type="button"
				onclick={() => go('/near')}
				class="rounded-2xl border border-line bg-panel/60 p-3 text-left"
			>
				<span class="block text-sm font-medium text-primary">Map</span>
				<span class="mt-0.5 block text-xs text-tertiary">Pins + nearby</span>
			</button>
			<button
				type="button"
				onclick={() => go('/lists?new=1')}
				class="rounded-2xl border border-line bg-panel/60 p-3 text-left"
			>
				<span class="block text-sm font-medium text-primary">New list</span>
				<span class="mt-0.5 block text-xs text-tertiary">Create group</span>
			</button>
			<button
				type="button"
				onclick={() => go('/inbox')}
				class="rounded-2xl border border-line bg-panel/60 p-3 text-left"
			>
				<span class="block text-sm font-medium text-primary">Inbox</span>
				<span class="mt-0.5 block text-xs text-tertiary">Resolve links</span>
			</button>
		</div>
	</section>
{/if}

<script lang="ts">
	import AttributeToggle from './AttributeToggle.svelte';
	import type { AttributeDefinition, AttributeValue } from '$lib/attributes';
	import { connectivity, OFFLINE_WRITE_MESSAGE } from '$lib/connectivity.svelte';

	type Props = {
		restaurantUuid: string;
		definitions: AttributeDefinition[];
		current: Record<string, AttributeValue>;
		onSaved?: (next: Record<string, AttributeValue>) => void;
		onClose?: () => void;
	};

	let { restaurantUuid, definitions, current, onSaved, onClose }: Props = $props();

	// Snapshot at mount, then track edits locally.
	// svelte-ignore state_referenced_locally
	let answers = $state<Record<string, AttributeValue>>({ ...current });
	let saving = $state(false);
	let err = $state<string | null>(null);

	function setValue(id: string, next: AttributeValue | null) {
		const copy = { ...answers };
		if (next === 'yes' || next === 'no') copy[id] = next;
		else delete copy[id];
		answers = copy;
	}

	async function save() {
		if (!connectivity.online) { err = OFFLINE_WRITE_MESSAGE; return; }
		saving = true;
		err = null;
		try {
			const res = await fetch(`/api/restaurants/${restaurantUuid}/attributes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ attributes: answers })
			});
			if (!res.ok) {
				err = `Failed: ${res.status}`;
				saving = false;
				return;
			}
			const data = (await res.json()) as { attributes: Record<string, AttributeValue> };
			onSaved?.(data.attributes);
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
			<h2 class="text-base font-medium text-primary">Attributes</h2>
			<button type="button" onclick={() => onClose?.()} class="text-xs text-secondary">Cancel</button>
		</header>

		{#if definitions.length === 0}
			<p class="text-xs text-tertiary">
				No attributes apply to this restaurant. Define attributes in Settings.
			</p>
		{:else}
			<ul class="divide-y divide-line/60">
				{#each definitions as def (def.id)}
					<li class="flex items-center justify-between gap-3 py-3">
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm text-primary">{def.label}</p>
							{#if def.description}
								<p class="mt-0.5 text-[11px] text-tertiary">{def.description}</p>
							{/if}
						</div>
						<AttributeToggle
							value={answers[def.id] ?? null}
							label={def.label}
							onchange={(next) => setValue(def.id, next)}
						/>
					</li>
				{/each}
			</ul>
		{/if}

		{#if err}
			<p class="mt-2 text-xs text-danger">{err}</p>
		{/if}

		<button
			type="button"
			onclick={save}
			disabled={saving || definitions.length === 0 || !connectivity.online}
			class="mt-4 w-full rounded-2xl bg-accent px-5 py-3 text-center text-sm font-medium text-on-accent disabled:opacity-50"
		>
			{saving ? 'Saving…' : 'Save'}
		</button>
	</section>
</div>

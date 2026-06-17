<script module lang="ts">
	export type EditorDish = {
		name: string;
		rating: number;
		note: string;
		photo: File | null;
		existingPhotoPath: string | null;
	};
</script>

<script lang="ts">
	import StarPicker from './StarPicker.svelte';
	import { resizeForUpload } from '$lib/imageResize';

	type Props = {
		dishes: EditorDish[];
		disabled?: boolean;
	};
	let { dishes = $bindable(), disabled = false }: Props = $props();

	const ratedCount = $derived(dishes.filter((d) => d.rating > 0).length);
	const foodAvg = $derived.by(() => {
		const rated = dishes.map((d) => d.rating).filter((r) => r > 0);
		if (rated.length === 0) return null;
		return Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10;
	});

	function addDish() {
		dishes = [...dishes, { name: '', rating: 0, note: '', photo: null, existingPhotoPath: null }];
	}

	function removeDish(i: number) {
		dishes = dishes.filter((_, idx) => idx !== i);
	}

	function patch(i: number, change: Partial<EditorDish>) {
		dishes = dishes.map((d, idx) => (idx === i ? { ...d, ...change } : d));
	}

	async function onPhoto(i: number, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		const file = input.files[0];
		input.value = '';
		let resized = file;
		try {
			resized = await resizeForUpload(file);
		} catch {
			// keep original on resize failure
		}
		patch(i, { photo: resized, existingPhotoPath: null });
	}

	function clearPhoto(i: number) {
		patch(i, { photo: null, existingPhotoPath: null });
	}

	function previewUrl(file: File): string {
		return URL.createObjectURL(file);
	}

	function thumbUrl(path: string): string {
		return `/api/attachments/${path.replace(/^_attachments\//, '')}`;
	}
</script>

<div class="rounded-xl border border-line bg-panel/40 p-3">
	<div class="flex items-center justify-between gap-2">
		<span class="text-xs text-secondary">Dishes</span>
		<span class="text-[11px] text-tertiary">
			{#if foodAvg != null}
				Food avg ★ {foodAvg} <span class="text-tertiary">({ratedCount} rated)</span>
			{:else}
				Rate dishes to set the Food score
			{/if}
		</span>
	</div>

	{#if dishes.length > 0}
		<ul class="mt-2 space-y-3">
			{#each dishes as dish, i (i)}
				<li class="rounded-lg border border-line/70 bg-panel/60 p-2.5">
					<div class="flex items-center gap-2">
						<input
							type="text"
							value={dish.name}
							oninput={(e) => patch(i, { name: (e.currentTarget as HTMLInputElement).value })}
							placeholder="Dish name"
							maxlength="80"
							{disabled}
							class="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm text-primary placeholder:text-tertiary"
						/>
						<button
							type="button"
							onclick={() => removeDish(i)}
							{disabled}
							aria-label="Remove dish"
							class="shrink-0 rounded-lg border border-line px-2 py-1.5 text-xs text-tertiary hover:text-danger disabled:opacity-50"
						>
							✕
						</button>
					</div>

					<div class="mt-2">
						<StarPicker
							value={dish.rating}
							label={dish.name || 'Dish'}
							onchange={(n) => patch(i, { rating: n })}
						/>
					</div>

					<input
						type="text"
						value={dish.note}
						oninput={(e) => patch(i, { note: (e.currentTarget as HTMLInputElement).value })}
						placeholder="Note (optional)"
						maxlength="280"
						{disabled}
						class="mt-2 w-full rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm text-primary placeholder:text-tertiary"
					/>

					<div class="mt-2 flex items-center gap-2">
						{#if dish.photo || dish.existingPhotoPath}
							<div class="relative">
								<img
									src={dish.photo ? previewUrl(dish.photo) : thumbUrl(dish.existingPhotoPath!)}
									alt=""
									class="h-14 w-14 rounded-lg object-cover"
									class:ring-2={!!dish.photo}
									class:ring-accent-ring={!!dish.photo}
								/>
								<button
									type="button"
									onclick={() => clearPhoto(i)}
									{disabled}
									aria-label="Remove dish photo"
									class="absolute -top-1.5 -right-1.5 rounded-full border border-line bg-panel px-1 text-[10px] text-primary"
								>
									×
								</button>
							</div>
						{/if}
						<label
							class="cursor-pointer rounded-lg border border-dashed border-line-strong bg-panel/40 px-3 py-2 text-xs text-secondary"
						>
							<input
								type="file"
								accept="image/*"
								onchange={(e) => onPhoto(i, e)}
								{disabled}
								class="hidden"
							/>
							<span>{dish.photo || dish.existingPhotoPath ? '📷 Replace' : '📷 Add photo'}</span>
						</label>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<button
		type="button"
		onclick={addDish}
		{disabled}
		class="mt-3 w-full rounded-lg border border-dashed border-line-strong bg-panel/40 py-2 text-xs font-medium text-accent disabled:opacity-50"
	>
		+ Add dish
	</button>
</div>

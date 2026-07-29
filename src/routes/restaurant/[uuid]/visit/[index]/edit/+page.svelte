<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { resizeForUpload } from '$lib/imageResize';
	import StarPicker from '$lib/components/StarPicker.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import AttributeToggle from '$lib/components/AttributeToggle.svelte';
	import DishBreakdown, { type EditorDish } from '$lib/components/DishBreakdown.svelte';
	import type { AttributeValue } from '$lib/attributes';
	import { connectivity, OFFLINE_WRITE_MESSAGE } from '$lib/connectivity.svelte';

	let { data }: { data: PageData } = $props();
	const usePerArea = $derived(data.preferences.per_area_ratings);
	const useFoodBreakdown = $derived(usePerArea && data.preferences.food_breakdown);

	// svelte-ignore state_referenced_locally
	const initial = data.fields;
	let date = $state(initial.date);
	let meal = $state(initial.meal ?? '');
	let companions = $state(initial.companions ?? '');
	let vibe = $state(initial.vibe ?? '');
	let food = $state(initial.food ?? '');
	let quality = $state(initial.quality ?? '');
	let service = $state(initial.service ?? '');
	let rating = $state<string>(initial.rating != null ? String(initial.rating) : '');
	let vibeRating = $state(initial.vibeRating ?? 0);
	let foodRating = $state(initial.foodRating ?? 0);
	let qualityRating = $state(initial.qualityRating ?? 0);
	let serviceRating = $state(initial.serviceRating ?? 0);
	let notes = $state(initial.notes ?? '');
	let attributeOverrides = $state<Record<string, AttributeValue>>({ ...initial.attributeOverrides });
	let showAttributes = $state(Object.keys(initial.attributeOverrides).length > 0);

	// svelte-ignore state_referenced_locally
	let dishEntries = $state<EditorDish[]>(
		initial.dishes.map((d) => ({
			name: d.name,
			rating: d.rating ?? 0,
			note: d.note ?? '',
			photo: null,
			existingPhotoPath: d.photoPath
		}))
	);
	// Show the breakdown editor when the preference is on OR the visit already
	// has dishes — so existing dish data is never silently hidden/dropped.
	const showDishes = $derived(useFoodBreakdown || dishEntries.length > 0);

	function setOverride(id: string, next: AttributeValue | null) {
		const copy = { ...attributeOverrides };
		if (next === 'yes' || next === 'no') copy[id] = next;
		else delete copy[id];
		attributeOverrides = copy;
	}

	// Existing photos that the user has chosen to keep. Dish photos are managed by
	// the breakdown editor, so exclude them from the general photo list.
	// svelte-ignore state_referenced_locally
	const dishPhotoSet = new Set(
		initial.dishes.map((d) => d.photoPath).filter((p): p is string => !!p)
	);
	let keptPhotos = $state<string[]>(initial.photoPaths.filter((p) => !dishPhotoSet.has(p)));
	let pickedFiles = $state<File[]>([]);
	let saving = $state(false);
	let deleting = $state(false);
	let progress = $state<string | null>(null);
	let err = $state<string | null>(null);

	let photoToRemove = $state<string | null>(null);
	let confirmDelete = $state(false);

	const totalPhotos = $derived(keptPhotos.length + pickedFiles.length);

	const foodAvgLive = $derived.by(() => {
		const rated = dishEntries.map((d) => d.rating).filter((r) => r > 0);
		if (rated.length === 0) return null;
		return Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10;
	});
	const effectiveFoodRating = $derived(showDishes ? (foodAvgLive ?? 0) : foodRating);

	const areaRatings = $derived(
		[vibeRating, effectiveFoodRating, qualityRating, serviceRating].filter((r) => r > 0)
	);
	const areaAverage = $derived(
		areaRatings.length > 0
			? Math.round((areaRatings.reduce((a, b) => a + b, 0) / areaRatings.length) * 10) / 10
			: null
	);

	async function onFilePick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (!input.files) return;
		const incoming = Array.from(input.files);
		input.value = '';
		progress = 'Compressing photos…';
		const resized: File[] = [];
		for (const f of incoming) {
			try {
				resized.push(await resizeForUpload(f));
			} catch {
				resized.push(f);
			}
		}
		pickedFiles = [...pickedFiles, ...resized].slice(0, 8 - keptPhotos.length);
		progress = null;
	}

	function previewUrl(file: File): string {
		return URL.createObjectURL(file);
	}

	function thumbUrl(path: string): string {
		const rel = path.replace(/^_attachments\//, '');
		return `/api/attachments/${rel}`;
	}

	function removePickedPhoto(idx: number) {
		pickedFiles = pickedFiles.filter((_, i) => i !== idx);
	}

	function confirmRemoveExisting(p: string) {
		photoToRemove = p;
	}

	function doRemoveExisting() {
		if (!photoToRemove) return;
		keptPhotos = keptPhotos.filter((p) => p !== photoToRemove);
		photoToRemove = null;
	}

	async function submit(e: Event) {
		e.preventDefault();
		if (!connectivity.online) { err = OFFLINE_WRITE_MESSAGE; return; }
		saving = true;
		err = null;
		progress = 'Saving…';

		const form = new FormData();
		form.set('date', date);
		if (meal) form.set('meal', meal);
		if (companions) form.set('companions', companions);
		if (vibe) form.set('vibe', vibe);
		if (food) form.set('food', food);
		if (quality) form.set('quality', quality);
		if (service) form.set('service', service);
		if (notes) form.set('notes', notes);
		if (usePerArea) {
			if (vibeRating > 0) form.set('vibe_rating', String(vibeRating));
			if (!showDishes && foodRating > 0) form.set('food_rating', String(foodRating));
			if (qualityRating > 0) form.set('quality_rating', String(qualityRating));
			if (serviceRating > 0) form.set('service_rating', String(serviceRating));
		} else if (rating) {
			form.set('rating', rating);
		}
		// Dishes (Food breakdown). Always sent when present so edits never drop
		// existing dish data, even if the global preference is off.
		if (dishEntries.length > 0) {
			form.set(
				'dishes',
				JSON.stringify(
					dishEntries.map((d) => ({
						name: d.name,
						rating: d.rating > 0 ? d.rating : null,
						note: d.note || null,
						keepPhoto: d.existingPhotoPath
					}))
				)
			);
			dishEntries.forEach((d, i) => {
				if (d.photo) form.set(`dish_photo_${i}`, d.photo);
			});
		}
		for (const [id, v] of Object.entries(attributeOverrides)) {
			form.set(`attribute_${id}`, v);
		}
		for (const p of keptPhotos) form.append('keep_photo', p);
		for (const f of pickedFiles) form.append('photo', f);

		try {
			const res = await fetch(`/api/restaurants/${data.uuid}/visits/${data.index}`, {
				method: 'PUT',
				body: form
			});
			if (!res.ok) {
				err = `Save failed: ${res.status} ${await res.text().catch(() => '')}`;
				saving = false;
				progress = null;
				return;
			}
			await goto(`/restaurant/${data.uuid}`);
		} catch (e) {
			err = `Save failed: ${String(e)}`;
			saving = false;
			progress = null;
		}
	}

	async function deleteVisit() {
		if (!connectivity.online) { err = OFFLINE_WRITE_MESSAGE; return; }
		deleting = true;
		err = null;
		try {
			const res = await fetch(`/api/restaurants/${data.uuid}/visits/${data.index}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				err = `Delete failed: ${res.status} ${await res.text().catch(() => '')}`;
				deleting = false;
				return;
			}
			await goto(`/restaurant/${data.uuid}`);
		} catch (e) {
			err = `Delete failed: ${String(e)}`;
			deleting = false;
		}
	}
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href={`/restaurant/${data.uuid}`} label="Cancel" />
	<h1 class="mt-2 text-2xl font-semibold text-primary">Edit visit</h1>
	<p class="mt-0.5 text-sm text-secondary">{data.name} · {data.headline}</p>
</header>

<form onsubmit={submit} class="space-y-3 px-5 pb-10">
	<div class="grid grid-cols-2 gap-3">
		<label class="flex flex-col gap-1">
			<span class="text-xs text-secondary">Date</span>
			<input
				type="date"
				bind:value={date}
				class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-xs text-secondary">Meal</span>
			<input
				type="text"
				bind:value={meal}
				placeholder="Lunch / Dinner / Drinks"
				maxlength="40"
				class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary"
			/>
		</label>
	</div>

	<label class="flex flex-col gap-1">
		<span class="text-xs text-secondary">With (companions)</span>
		<input
			type="text"
			bind:value={companions}
			placeholder="Names — Obsidian [[wikilinks]] are fine"
			maxlength="200"
			class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary"
		/>
	</label>

	{#snippet areaField(label: string, value: string, setValue: (v: string) => void, placeholder: string, rate: number, setRate: (n: number) => void)}
		<div class="flex flex-col gap-1">
			<div class="flex items-center justify-between">
				<span class="text-xs text-secondary">{label}</span>
				{#if usePerArea}
					<StarPicker value={rate} label={label} onchange={setRate} />
				{/if}
			</div>
			<textarea
				value={value}
				oninput={(e) => setValue((e.currentTarget as HTMLTextAreaElement).value)}
				rows="2"
				placeholder={placeholder}
				class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary"
			></textarea>
		</div>
	{/snippet}

	{@render areaField('Vibe', vibe, (v) => (vibe = v), 'Loud, bright, friendly…', vibeRating, (n) => (vibeRating = n))}

	{#if showDishes}
		<div class="flex flex-col gap-1">
			<div class="flex items-center justify-between">
				<span class="text-xs text-secondary">Food</span>
				{#if foodAvgLive != null}
					<span class="text-xs text-rating">★ {foodAvgLive}</span>
				{/if}
			</div>
			<textarea
				bind:value={food}
				rows="2"
				placeholder="Overall food note (optional)"
				class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary"
			></textarea>
			<DishBreakdown bind:dishes={dishEntries} />
		</div>
	{:else}
		{@render areaField('Food', food, (v) => (food = v), 'What you ordered', foodRating, (n) => (foodRating = n))}
	{/if}

	{@render areaField('Quality', quality, (v) => (quality = v), 'How it tasted', qualityRating, (n) => (qualityRating = n))}
	{@render areaField('Service', service, (v) => (service = v), 'Friendly, attentive, slow…', serviceRating, (n) => (serviceRating = n))}

	{#if usePerArea}
		<div class="rounded-xl border border-line bg-panel/40 px-3 py-2 text-sm">
			<span class="text-xs text-secondary">Average</span>
			<span class="ml-2 text-primary">
				{areaAverage != null ? `${areaAverage}/5` : '—'}
			</span>
			<span class="ml-2 text-[11px] text-tertiary">
				(from {areaRatings.length} of 4 rated)
			</span>
		</div>
	{:else}
		<label class="flex flex-col gap-1">
			<span class="text-xs text-secondary">Rating (0–5)</span>
			<input
				type="number"
				bind:value={rating}
				min="0"
				max="5"
				step="0.5"
				class="w-24 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary"
			/>
		</label>
	{/if}

	<label class="flex flex-col gap-1">
		<span class="text-xs text-secondary">Free-form notes</span>
		<textarea
			bind:value={notes}
			rows="3"
			placeholder="Anything else"
			class="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary"
		></textarea>
	</label>

	{#if data.applicableAttributes.length > 0}
		<details
			bind:open={showAttributes}
			class="rounded-xl border border-line bg-panel/40"
		>
			<summary class="cursor-pointer list-none px-3 py-2 text-xs text-secondary">
				<span>Attributes (overrides for this visit)</span>
				{#if Object.keys(attributeOverrides).length > 0}
					<span class="ml-2 text-accent">{Object.keys(attributeOverrides).length} set</span>
				{/if}
			</summary>
			<div class="border-t border-line/60 px-3 py-2">
				<p class="mb-2 text-[11px] text-tertiary">
					Unset = use restaurant default.
				</p>
				<ul class="divide-y divide-line/40">
					{#each data.applicableAttributes as def (def.id)}
						{@const restaurantValue = data.restaurantAttributes[def.id] ?? null}
						<li class="flex items-center justify-between gap-3 py-2">
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm text-primary">{def.label}</p>
								<p class="mt-0.5 text-[11px] text-tertiary">
									Default: {restaurantValue === 'yes' ? '✓ Yes' : restaurantValue === 'no' ? '✕ No' : '—'}
								</p>
							</div>
							<AttributeToggle
								value={attributeOverrides[def.id] ?? null}
								label={def.label}
								unsetLabel="Use default"
								size="sm"
								onchange={(next) => setOverride(def.id, next)}
							/>
						</li>
					{/each}
				</ul>
			</div>
		</details>
	{/if}

	<div>
		<div class="mb-2 flex items-center justify-between">
			<span class="text-xs text-secondary">Photos ({totalPhotos}/8)</span>
		</div>
		{#if keptPhotos.length + pickedFiles.length > 0}
			<div class="mb-3 grid grid-cols-3 gap-2">
				{#each keptPhotos as p (p)}
					<div class="relative">
						<img
							src={thumbUrl(p)}
							alt=""
							class="aspect-square w-full rounded-lg object-cover"
						/>
						<button
							type="button"
							onclick={() => confirmRemoveExisting(p)}
							title="Remove photo (deletes the file from your vault)"
							aria-label="Remove photo"
							class="absolute top-1 right-1 rounded-full bg-panel/80 px-1.5 py-0.5 text-[10px] text-primary"
						>
							×
						</button>
					</div>
				{/each}
				{#each pickedFiles as f, i (i)}
					<div class="relative">
						<img
							src={previewUrl(f)}
							alt={`new photo ${i + 1}`}
							class="aspect-square w-full rounded-lg object-cover ring-2 ring-accent-ring/60"
						/>
						<button
							type="button"
							onclick={() => removePickedPhoto(i)}
							aria-label="Discard new photo"
							class="absolute top-1 right-1 rounded-full bg-panel/80 px-1.5 py-0.5 text-[10px] text-primary"
						>
							×
						</button>
					</div>
				{/each}
			</div>
		{/if}
		{#if totalPhotos < 8}
			<label
				class="block rounded-xl border border-dashed border-line-strong bg-panel/40 py-4 text-center text-sm text-secondary"
			>
				<input
					type="file"
					accept="image/*"
					multiple
					onchange={onFilePick}
					class="hidden"
				/>
				<span>📷 Add photos</span>
			</label>
		{/if}
	</div>

	{#if progress}
		<p class="text-xs text-secondary">{progress}</p>
	{/if}
	{#if err}
		<p class="text-xs text-danger">{err}</p>
	{/if}

	<button
		type="submit"
		disabled={saving || deleting || !connectivity.online}
		class="mt-2 w-full rounded-2xl bg-accent px-5 py-3 text-center text-sm font-medium text-on-accent disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save changes'}
	</button>

	<button
		type="button"
		onclick={() => (confirmDelete = true)}
		disabled={saving || deleting}
		class="mt-1 w-full rounded-2xl border border-danger/50 bg-danger/10 px-5 py-3 text-center text-sm font-medium text-danger hover:bg-danger/15 disabled:opacity-50"
	>
		Delete visit
	</button>
</form>

{#if photoToRemove}
	<div
		class="fixed inset-0 z-40 flex items-end justify-center bg-overlay sm:items-center"
		role="dialog"
		aria-modal="true"
	>
		<button
			type="button"
			class="absolute inset-0 -z-10 h-full w-full cursor-default"
			aria-label="Close"
			onclick={() => (photoToRemove = null)}
		></button>
		<section class="w-full max-w-md rounded-t-3xl border-t border-line bg-panel p-5 pb-8 sm:rounded-3xl sm:border">
			<h2 class="text-base font-medium text-primary">Remove this photo?</h2>
			<p class="mt-2 text-sm text-secondary">
				The image will be removed from the visit and <span class="text-rating">deleted from your
				vault on disk</span>. This can't be undone (unless your vault is backed up by Obsidian Sync or iCloud).
			</p>
			<div class="mt-4 grid grid-cols-2 gap-2">
				<button
					type="button"
					onclick={() => (photoToRemove = null)}
					class="rounded-2xl border border-line-strong bg-panel-2 px-4 py-3 text-sm text-secondary"
				>
					Keep
				</button>
				<button
					type="button"
					onclick={doRemoveExisting}
					class="rounded-2xl bg-danger px-4 py-3 text-sm font-medium text-white"
				>
					Remove
				</button>
			</div>
			<p class="mt-2 text-[11px] text-tertiary">
				The file is only deleted when you click <span class="text-secondary">Save changes</span> above —
				cancel out of the form and nothing will be touched.
			</p>
		</section>
	</div>
{/if}

{#if confirmDelete}
	<div
		class="fixed inset-0 z-40 flex items-end justify-center bg-overlay sm:items-center"
		role="dialog"
		aria-modal="true"
	>
		<button
			type="button"
			class="absolute inset-0 -z-10 h-full w-full cursor-default"
			aria-label="Close"
			onclick={() => (confirmDelete = false)}
		></button>
		<section class="w-full max-w-md rounded-t-3xl border-t border-line bg-panel p-5 pb-8 sm:rounded-3xl sm:border">
			<h2 class="text-base font-medium text-primary">Delete this visit?</h2>
			<p class="mt-2 text-sm text-secondary">
				This removes the <span class="text-secondary">{data.headline}</span> block from the note and
				<span class="text-rating">deletes its {data.fields.photoPaths.length} photo{data.fields.photoPaths.length === 1 ? '' : 's'}</span>
				from your vault. Other visits stay intact.
			</p>
			<div class="mt-4 grid grid-cols-2 gap-2">
				<button
					type="button"
					onclick={() => (confirmDelete = false)}
					disabled={deleting}
					class="rounded-2xl border border-line-strong bg-panel-2 px-4 py-3 text-sm text-secondary disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={deleteVisit}
					disabled={deleting || !connectivity.online}
					class="rounded-2xl bg-danger px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
				>
					{deleting ? 'Deleting…' : 'Delete'}
				</button>
			</div>
		</section>
	</div>
{/if}

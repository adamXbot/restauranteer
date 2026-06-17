<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { resizeForUpload } from '$lib/imageResize';
	import { enqueueVisit } from '$lib/visitQueue';
	import StarPicker from '$lib/components/StarPicker.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import AttributeToggle from '$lib/components/AttributeToggle.svelte';
	import DishBreakdown, { type EditorDish } from '$lib/components/DishBreakdown.svelte';
	import type { AttributeValue } from '$lib/attributes';

	let { data }: { data: PageData } = $props();
	const usePerArea = $derived(data.preferences.per_area_ratings);
	const useFoodBreakdown = $derived(usePerArea && data.preferences.food_breakdown);
	let attributeOverrides = $state<Record<string, AttributeValue>>({});
	let showAttributes = $state(false);
	let dishEntries = $state<EditorDish[]>([]);

	function setOverride(id: string, next: AttributeValue | null) {
		const copy = { ...attributeOverrides };
		if (next === 'yes' || next === 'no') copy[id] = next;
		else delete copy[id];
		attributeOverrides = copy;
	}

	const today = new Date().toISOString().slice(0, 10);
	let date = $state(today);
	let meal = $state('');
	let companions = $state('');
	let vibe = $state('');
	let food = $state('');
	let quality = $state('');
	let service = $state('');
	let rating = $state<string>('');
	let vibeRating = $state(0);
	let foodRating = $state(0);
	let qualityRating = $state(0);
	let serviceRating = $state(0);
	let notes = $state('');
	let pickedFiles = $state<File[]>([]);
	let saving = $state(false);
	let progress = $state<string | null>(null);
	let err = $state<string | null>(null);

	const foodAvgLive = $derived.by(() => {
		const rated = dishEntries.map((d) => d.rating).filter((r) => r > 0);
		if (rated.length === 0) return null;
		return Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10;
	});
	const effectiveFoodRating = $derived(useFoodBreakdown ? (foodAvgLive ?? 0) : foodRating);

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
		pickedFiles = [...pickedFiles, ...resized].slice(0, 8);
		progress = null;
	}

	function removePhoto(idx: number) {
		pickedFiles = pickedFiles.filter((_, i) => i !== idx);
	}

	function previewUrl(file: File): string {
		return URL.createObjectURL(file);
	}

	function buildFields(): Record<string, string> {
		const out: Record<string, string> = { date };
		if (meal) out.meal = meal;
		if (companions) out.companions = companions;
		if (vibe) out.vibe = vibe;
		if (food) out.food = food;
		if (quality) out.quality = quality;
		if (service) out.service = service;
		if (notes) out.notes = notes;
		if (usePerArea) {
			if (vibeRating > 0) out.vibe_rating = String(vibeRating);
			if (!useFoodBreakdown && foodRating > 0) out.food_rating = String(foodRating);
			if (qualityRating > 0) out.quality_rating = String(qualityRating);
			if (serviceRating > 0) out.service_rating = String(serviceRating);
		} else if (rating) {
			out.rating = rating;
		}
		if (useFoodBreakdown && dishEntries.length > 0) {
			out.dishes = JSON.stringify(
				dishEntries.map((d) => ({
					name: d.name,
					rating: d.rating > 0 ? d.rating : null,
					note: d.note || null,
					keepPhoto: d.existingPhotoPath
				}))
			);
		}
		for (const [id, v] of Object.entries(attributeOverrides)) {
			out[`attribute_${id}`] = v;
		}
		return out;
	}

	/** Newly-picked dish photos paired with their `dish_photo_<i>` field names. */
	function dishPhotoUploads(): { files: File[]; fields: string[] } {
		const files: File[] = [];
		const fields: string[] = [];
		if (useFoodBreakdown) {
			dishEntries.forEach((d, i) => {
				if (d.photo) {
					files.push(d.photo);
					fields.push(`dish_photo_${i}`);
				}
			});
		}
		return { files, fields };
	}

	async function queueOffline(reason: string) {
		try {
			const dishUploads = dishPhotoUploads();
			await enqueueVisit({
				restaurantUuid: data.uuid,
				restaurantName: data.name,
				fields: buildFields(),
				photos: [...pickedFiles, ...dishUploads.files],
				photoFields: [...pickedFiles.map(() => 'photo'), ...dishUploads.fields]
			});
			progress = `Saved offline (${reason}). Will sync when online.`;
			setTimeout(() => goto(`/restaurant/${data.uuid}`), 1200);
		} catch (e) {
			err = `Offline save failed: ${String(e)}`;
			saving = false;
			progress = null;
		}
	}

	async function submit(e: Event) {
		e.preventDefault();
		saving = true;
		err = null;
		progress = 'Uploading…';

		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			await queueOffline('no network');
			return;
		}

		const form = new FormData();
		for (const [k, v] of Object.entries(buildFields())) form.set(k, v);
		for (const f of pickedFiles) form.append('photo', f);
		const dishUploads = dishPhotoUploads();
		for (let i = 0; i < dishUploads.files.length; i++) {
			form.set(dishUploads.fields[i], dishUploads.files[i]);
		}

		try {
			const res = await fetch(`/api/restaurants/${data.uuid}/visits`, {
				method: 'POST',
				body: form
			});
			if (!res.ok) {
				err = `Save failed: ${res.status}`;
				saving = false;
				progress = null;
				return;
			}
			await goto(`/restaurant/${data.uuid}`);
		} catch {
			// fetch threw — most often a network error. Queue locally.
			await queueOffline('connection failed');
		}
	}
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href={`/restaurant/${data.uuid}`} label="Cancel" />
	<h1 class="mt-2 text-2xl font-semibold text-primary">New visit</h1>
	<p class="mt-0.5 text-sm text-secondary">{data.name}</p>
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

	{#if useFoodBreakdown}
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
			<span class="text-xs text-secondary">Photos ({pickedFiles.length}/8)</span>
		</div>
		{#if pickedFiles.length > 0}
			<div class="mb-3 grid grid-cols-3 gap-2">
				{#each pickedFiles as f, i (i)}
					<div class="relative">
						<img
							src={previewUrl(f)}
							alt={`photo ${i + 1}`}
							class="aspect-square w-full rounded-lg object-cover"
						/>
						<button
							type="button"
							onclick={() => removePhoto(i)}
							class="absolute top-1 right-1 rounded-full bg-panel/80 px-1.5 py-0.5 text-[10px] text-primary"
						>
							×
						</button>
					</div>
				{/each}
			</div>
		{/if}
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
			<span>📷 Take or choose photos</span>
		</label>
	</div>

	{#if progress}
		<p class="text-xs text-secondary">{progress}</p>
	{/if}
	{#if err}
		<p class="text-xs text-danger">{err}</p>
	{/if}

	<button
		type="submit"
		disabled={saving}
		class="mt-2 w-full rounded-2xl bg-accent px-5 py-3 text-center text-sm font-medium text-on-accent disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save visit'}
	</button>
</form>

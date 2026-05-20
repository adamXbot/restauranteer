<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { resizeForUpload } from '$lib/imageResize';
	import StarPicker from '$lib/components/StarPicker.svelte';
	import BackLink from '$lib/components/BackLink.svelte';

	let { data }: { data: PageData } = $props();
	const usePerArea = $derived(data.preferences.per_area_ratings);

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

	// Existing photos that the user has chosen to keep.
	let keptPhotos = $state<string[]>(initial.photoPaths.slice());
	let pickedFiles = $state<File[]>([]);
	let saving = $state(false);
	let deleting = $state(false);
	let progress = $state<string | null>(null);
	let err = $state<string | null>(null);

	let photoToRemove = $state<string | null>(null);
	let confirmDelete = $state(false);

	const totalPhotos = $derived(keptPhotos.length + pickedFiles.length);

	const areaRatings = $derived(
		[vibeRating, foodRating, qualityRating, serviceRating].filter((r) => r > 0)
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
			if (foodRating > 0) form.set('food_rating', String(foodRating));
			if (qualityRating > 0) form.set('quality_rating', String(qualityRating));
			if (serviceRating > 0) form.set('service_rating', String(serviceRating));
		} else if (rating) {
			form.set('rating', rating);
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
	<h1 class="mt-2 text-2xl font-semibold text-slate-50">Edit visit</h1>
	<p class="mt-0.5 text-sm text-slate-400">{data.name} · {data.headline}</p>
</header>

<form onsubmit={submit} class="space-y-3 px-5 pb-10">
	<div class="grid grid-cols-2 gap-3">
		<label class="flex flex-col gap-1">
			<span class="text-xs text-slate-400">Date</span>
			<input
				type="date"
				bind:value={date}
				class="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-xs text-slate-400">Meal</span>
			<input
				type="text"
				bind:value={meal}
				placeholder="Lunch / Dinner / Drinks"
				maxlength="40"
				class="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
			/>
		</label>
	</div>

	<label class="flex flex-col gap-1">
		<span class="text-xs text-slate-400">With (companions)</span>
		<input
			type="text"
			bind:value={companions}
			placeholder="Names — Obsidian [[wikilinks]] are fine"
			maxlength="200"
			class="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
		/>
	</label>

	{#snippet areaField(label: string, value: string, setValue: (v: string) => void, placeholder: string, rate: number, setRate: (n: number) => void)}
		<div class="flex flex-col gap-1">
			<div class="flex items-center justify-between">
				<span class="text-xs text-slate-400">{label}</span>
				{#if usePerArea}
					<StarPicker value={rate} label={label} onchange={setRate} />
				{/if}
			</div>
			<textarea
				value={value}
				oninput={(e) => setValue((e.currentTarget as HTMLTextAreaElement).value)}
				rows="2"
				placeholder={placeholder}
				class="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
			></textarea>
		</div>
	{/snippet}

	{@render areaField('Vibe', vibe, (v) => (vibe = v), 'Loud, bright, friendly…', vibeRating, (n) => (vibeRating = n))}
	{@render areaField('Food', food, (v) => (food = v), 'What you ordered', foodRating, (n) => (foodRating = n))}
	{@render areaField('Quality', quality, (v) => (quality = v), 'How it tasted', qualityRating, (n) => (qualityRating = n))}
	{@render areaField('Service', service, (v) => (service = v), 'Friendly, attentive, slow…', serviceRating, (n) => (serviceRating = n))}

	{#if usePerArea}
		<div class="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm">
			<span class="text-xs text-slate-400">Average</span>
			<span class="ml-2 text-slate-100">
				{areaAverage != null ? `${areaAverage}/5` : '—'}
			</span>
			<span class="ml-2 text-[11px] text-slate-500">
				(from {areaRatings.length} of 4 rated)
			</span>
		</div>
	{:else}
		<label class="flex flex-col gap-1">
			<span class="text-xs text-slate-400">Rating (0–5)</span>
			<input
				type="number"
				bind:value={rating}
				min="0"
				max="5"
				step="0.5"
				class="w-24 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
			/>
		</label>
	{/if}

	<label class="flex flex-col gap-1">
		<span class="text-xs text-slate-400">Free-form notes</span>
		<textarea
			bind:value={notes}
			rows="3"
			placeholder="Anything else"
			class="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
		></textarea>
	</label>

	<div>
		<div class="mb-2 flex items-center justify-between">
			<span class="text-xs text-slate-400">Photos ({totalPhotos}/8)</span>
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
							class="absolute top-1 right-1 rounded-full bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-white"
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
							class="aspect-square w-full rounded-lg object-cover ring-2 ring-orange-500/60"
						/>
						<button
							type="button"
							onclick={() => removePickedPhoto(i)}
							aria-label="Discard new photo"
							class="absolute top-1 right-1 rounded-full bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-white"
						>
							×
						</button>
					</div>
				{/each}
			</div>
		{/if}
		{#if totalPhotos < 8}
			<label
				class="block rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-4 text-center text-sm text-slate-400"
			>
				<input
					type="file"
					accept="image/*"
					capture="environment"
					multiple
					onchange={onFilePick}
					class="hidden"
				/>
				<span>📷 Add photos</span>
			</label>
		{/if}
	</div>

	{#if progress}
		<p class="text-xs text-slate-400">{progress}</p>
	{/if}
	{#if err}
		<p class="text-xs text-red-400">{err}</p>
	{/if}

	<button
		type="submit"
		disabled={saving || deleting}
		class="mt-2 w-full rounded-2xl bg-orange-600 px-5 py-3 text-center text-sm font-medium text-white disabled:opacity-50"
	>
		{saving ? 'Saving…' : 'Save changes'}
	</button>

	<button
		type="button"
		onclick={() => (confirmDelete = true)}
		disabled={saving || deleting}
		class="mt-1 w-full rounded-2xl border border-red-900/60 bg-red-950/30 px-5 py-3 text-center text-sm font-medium text-red-300 hover:bg-red-950/50 disabled:opacity-50"
	>
		Delete visit
	</button>
</form>

{#if photoToRemove}
	<div
		class="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/70 sm:items-center"
		role="dialog"
		aria-modal="true"
	>
		<button
			type="button"
			class="absolute inset-0 -z-10 h-full w-full cursor-default"
			aria-label="Close"
			onclick={() => (photoToRemove = null)}
		></button>
		<section class="w-full max-w-md rounded-t-3xl border-t border-slate-800 bg-slate-900 p-5 pb-8 sm:rounded-3xl sm:border">
			<h2 class="text-base font-medium text-slate-100">Remove this photo?</h2>
			<p class="mt-2 text-sm text-slate-400">
				The image will be removed from the visit and <span class="text-amber-300">deleted from your
				vault on disk</span>. This can't be undone (unless your vault is backed up by Obsidian Sync or iCloud).
			</p>
			<div class="mt-4 grid grid-cols-2 gap-2">
				<button
					type="button"
					onclick={() => (photoToRemove = null)}
					class="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200"
				>
					Keep
				</button>
				<button
					type="button"
					onclick={doRemoveExisting}
					class="rounded-2xl bg-red-600 px-4 py-3 text-sm font-medium text-white"
				>
					Remove
				</button>
			</div>
			<p class="mt-2 text-[11px] text-slate-500">
				The file is only deleted when you click <span class="text-slate-300">Save changes</span> above —
				cancel out of the form and nothing will be touched.
			</p>
		</section>
	</div>
{/if}

{#if confirmDelete}
	<div
		class="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/70 sm:items-center"
		role="dialog"
		aria-modal="true"
	>
		<button
			type="button"
			class="absolute inset-0 -z-10 h-full w-full cursor-default"
			aria-label="Close"
			onclick={() => (confirmDelete = false)}
		></button>
		<section class="w-full max-w-md rounded-t-3xl border-t border-slate-800 bg-slate-900 p-5 pb-8 sm:rounded-3xl sm:border">
			<h2 class="text-base font-medium text-slate-100">Delete this visit?</h2>
			<p class="mt-2 text-sm text-slate-400">
				This removes the <span class="text-slate-200">{data.headline}</span> block from the note and
				<span class="text-amber-300">deletes its {data.fields.photoPaths.length} photo{data.fields.photoPaths.length === 1 ? '' : 's'}</span>
				from your vault. Other visits stay intact.
			</p>
			<div class="mt-4 grid grid-cols-2 gap-2">
				<button
					type="button"
					onclick={() => (confirmDelete = false)}
					disabled={deleting}
					class="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200 disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={deleteVisit}
					disabled={deleting}
					class="rounded-2xl bg-red-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
				>
					{deleting ? 'Deleting…' : 'Delete'}
				</button>
			</div>
		</section>
	</div>
{/if}

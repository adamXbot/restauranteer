<script lang="ts">
	import type { PlacePhoto } from '$lib/server/providers/google';
	import { lightboxGallery } from '$lib/photoswipe';

	let { photos }: { photos: PlacePhoto[] } = $props();

	const items = $derived(photos.slice(0, 10));
	function url(name: string, width: number): string {
		return `/api/photos?name=${encodeURIComponent(name)}&w=${width}`;
	}
</script>

<div
	use:lightboxGallery
	class="-mx-1 flex snap-x snap-mandatory overflow-x-auto px-1 pb-2"
>
	{#each items as photo, i (photo.name)}
		<a
			href={url(photo.name, 1600)}
			data-pswp-width={photo.width}
			data-pswp-height={photo.height}
			class="mx-1 shrink-0 snap-center first:ml-5 last:mr-5"
		>
			<img
				src={url(photo.name, 800)}
				srcset="{url(photo.name, 400)} 400w, {url(photo.name, 800)} 800w, {url(
					photo.name,
					1200
				)} 1200w"
				sizes="(max-width: 640px) 80vw, 480px"
				alt={photo.attributions[0] ?? `Photo ${i + 1}`}
				loading={i === 0 ? 'eager' : 'lazy'}
				class="h-56 w-72 rounded-2xl bg-slate-800 object-cover"
			/>
		</a>
	{/each}
</div>

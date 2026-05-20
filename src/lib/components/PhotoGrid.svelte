<script lang="ts">
	import { lightboxGallery } from '$lib/photoswipe';

	let { paths }: { paths: string[] } = $props();

	const FULL_MAX = 1600;
	const FALLBACK_DIMS = { w: FULL_MAX, h: FULL_MAX };
	let dims = $state<Record<string, { w: number; h: number }>>({});

	function url(relativePath: string): string {
		const rel = relativePath.replace(/^_attachments\//, '');
		return `/api/attachments/${encodeURI(rel)}`;
	}
	function thumbUrl(relativePath: string): string {
		const stem = relativePath.replace(/\.(jpg|jpeg|png|webp)$/i, '');
		return url(`${stem}.thumb.jpg`);
	}
	function recordDims(path: string, naturalWidth: number, naturalHeight: number) {
		if (!naturalWidth || !naturalHeight) return;
		const aspect = naturalWidth / naturalHeight;
		const [w, h] =
			aspect >= 1
				? [FULL_MAX, Math.round(FULL_MAX / aspect)]
				: [Math.round(FULL_MAX * aspect), FULL_MAX];
		dims[path] = { w, h };
	}
</script>

<div use:lightboxGallery class="-mx-1 mt-2 grid grid-cols-3 gap-1 px-1">
	{#each paths as p (p)}
		<a
			href={url(p)}
			data-pswp-width={(dims[p] ?? FALLBACK_DIMS).w}
			data-pswp-height={(dims[p] ?? FALLBACK_DIMS).h}
			class="block"
		>
			<img
				src={thumbUrl(p)}
				alt=""
				loading="lazy"
				class="aspect-square w-full rounded-lg bg-panel-2 object-cover"
				onload={(e) => {
					const t = e.currentTarget as HTMLImageElement;
					recordDims(p, t.naturalWidth, t.naturalHeight);
				}}
				onerror={(e) => {
					const target = e.currentTarget as HTMLImageElement;
					if (target.src !== url(p)) target.src = url(p);
				}}
			/>
		</a>
	{/each}
</div>

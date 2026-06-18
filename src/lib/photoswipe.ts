import 'photoswipe/style.css';

export function lightboxGallery(node: HTMLElement) {
	let lightbox: { destroy: () => void } | undefined;
	let alive = true;

	(async () => {
		const { default: PhotoSwipeLightbox } = await import('photoswipe/lightbox');
		if (!alive) return;
		const lb = new PhotoSwipeLightbox({
			gallery: node,
			children: 'a',
			pswpModule: () => import('photoswipe'),
			bgOpacity: 0.95,
			padding: { top: 24, bottom: 24, left: 8, right: 8 }
		});
		lb.init();
		lightbox = lb;
	})();

	return {
		destroy() {
			alive = false;
			lightbox?.destroy();
		}
	};
}

/**
 * Lightbox for rendered-markdown blocks (e.g. a visit's HTML) where images are
 * bare <img> tags. Wraps each image in a PhotoSwipe-compatible anchor (full-size
 * href + natural dimensions) and opens the same fullscreen viewer as the grids.
 * Non-image anchors (e.g. text links) are ignored via the children selector.
 */
export function lightboxImages(node: HTMLElement) {
	let lightbox: { destroy: () => void } | undefined;
	let alive = true;
	const FALLBACK = 1600;

	for (const img of Array.from(node.querySelectorAll('img'))) {
		// Skip images already inside an anchor (idempotent re-runs, linked images).
		if (img.parentElement?.tagName === 'A') continue;
		const a = document.createElement('a');
		a.href = img.src;
		a.setAttribute('data-pswp-width', String(img.naturalWidth || FALLBACK));
		a.setAttribute('data-pswp-height', String(img.naturalHeight || FALLBACK));
		img.replaceWith(a);
		a.appendChild(img);
		const sync = () => {
			if (img.naturalWidth && img.naturalHeight) {
				a.setAttribute('data-pswp-width', String(img.naturalWidth));
				a.setAttribute('data-pswp-height', String(img.naturalHeight));
			}
		};
		if (img.complete) sync();
		else img.addEventListener('load', sync, { once: true });
	}

	(async () => {
		const { default: PhotoSwipeLightbox } = await import('photoswipe/lightbox');
		if (!alive) return;
		const lb = new PhotoSwipeLightbox({
			gallery: node,
			children: 'a[data-pswp-width]',
			pswpModule: () => import('photoswipe'),
			bgOpacity: 0.95,
			padding: { top: 24, bottom: 24, left: 8, right: 8 }
		});
		lb.init();
		lightbox = lb;
	})();

	return {
		destroy() {
			alive = false;
			lightbox?.destroy();
		}
	};
}

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

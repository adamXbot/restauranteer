/**
 * Lazy-loads Apple MapKit JS from Apple's CDN and initialises it with a
 * server-signed JWT from /api/apple/maps-token.
 */

declare global {
	// eslint-disable-next-line no-var
	var mapkit: any;
	// eslint-disable-next-line no-var
	var __restauranteerMapKitReady: (() => void) | undefined;
}

let loadPromise: Promise<any> | null = null;
let initialised = false;

export async function loadMapKit(libraries = 'map,services,annotations'): Promise<any> {
	if (typeof window === 'undefined') throw new Error('MapKit only available in browser');
	if (window.mapkit && initialised) return window.mapkit;
	if (loadPromise) return loadPromise;

	loadPromise = new Promise((resolve, reject) => {
		const finish = () => {
			if (!initialised) {
				window.mapkit.init({
					authorizationCallback: (cb: (token: string) => void) => {
						fetch('/api/apple/maps-token')
							.then((r) => (r.ok ? r.text() : ''))
							.then((t) => cb(t))
							.catch(() => cb(''));
					}
				});
				initialised = true;
			}
			resolve(window.mapkit);
		};

		if (window.mapkit) {
			finish();
			return;
		}

		const script = document.createElement('script');
		script.src = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';
		script.crossOrigin = 'anonymous';
		script.dataset.libraries = libraries;
		script.dataset.callback = '__restauranteerMapKitReady';
		window.__restauranteerMapKitReady = finish;
		script.onerror = () => reject(new Error('MapKit JS failed to load'));
		document.head.appendChild(script);
	});

	return loadPromise;
}

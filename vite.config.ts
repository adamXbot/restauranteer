import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			strategies: 'generateSW',
			injectRegister: 'auto',
			manifest: false,
			workbox: {
				globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,webmanifest,woff,woff2}'],
				navigateFallback: '/',
				navigateFallbackDenylist: [/^\/api\//],
				runtimeCaching: [
					{
						urlPattern: /^\/api\/restaurants(\/|\?|$)/i,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'restaurant-details',
							expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 }
						}
					},
					{
						urlPattern: /^\/api\/(lists|near|search|map|places)(\/|\?|$)/i,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'api-views',
							expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 3 }
						}
					},
					{
						urlPattern: /\/__data\.json/i,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'page-data',
							expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 }
						}
					},
					{
						// Photos use a query-string URL (/api/photos?name=...), not a path segment.
						urlPattern: /^\/api\/photos(\?|$)/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'photos',
							expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }
						}
					},
					{
						urlPattern: /^\/api\/attachments\//i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'attachments',
							expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 30 }
						}
					}
				]
			},
			devOptions: {
				enabled: false,
				type: 'module'
			}
		})
	],
	server: {
		host: '0.0.0.0',
		port: 3000
	}
});

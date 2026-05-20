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
			manifest: {
				name: 'Restauranteer',
				short_name: 'Restauranteer',
				description: 'Your pocket restaurant companion',
				theme_color: '#0f172a',
				background_color: '#0f172a',
				display: 'standalone',
				orientation: 'portrait',
				start_url: '/',
				scope: '/',
				share_target: {
					action: '/inbox',
					method: 'GET',
					params: { url: 'url', title: 'title', text: 'text' }
				},
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
					{
						src: '/icons/icon-maskable-192.png',
						sizes: '192x192',
						type: 'image/png',
						purpose: 'maskable'
					},
					{
						src: '/icons/icon-maskable-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			workbox: {
				globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff,woff2}'],
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

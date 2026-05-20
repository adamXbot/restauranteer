import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			out: 'build'
		}),
		// Single-user personal app, often accessed via varied hostnames
		// (Tailscale URL, LAN IP, localhost). Origin-based CSRF check is
		// noise here — there's no second user who could mount an attack.
		csrf: { trustedOrigins: ['*'] }
	}
};

export default config;

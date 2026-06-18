import { browser } from '$app/environment';

/**
 * Shown by write actions that have no offline queue (everything except logging a
 * new visit) when the user tries to save while offline.
 */
export const OFFLINE_WRITE_MESSAGE = "You're offline — reconnect to save this.";

/**
 * App-wide connectivity state. Read `connectivity.online` reactively in any
 * component or `.svelte.ts` module. Defaults to online during SSR.
 */
export const connectivity = $state({ online: browser ? navigator.onLine : true });

if (browser) {
	window.addEventListener('online', () => (connectivity.online = true));
	window.addEventListener('offline', () => (connectivity.online = false));
}

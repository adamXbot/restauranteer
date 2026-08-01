import type { ServerInit } from '@sveltejs/kit';
import { bootVault, shutdownVault } from '$lib/server/vault';
import { authGuard } from '$lib/server/sync/auth';
import { log } from '$lib/server/log';

declare global {
	// eslint-disable-next-line no-var
	var __restauranteer_signals_attached: boolean | undefined;
}

export const init: ServerInit = async () => {
	try {
		await bootVault();
	} catch (err) {
		log.error('Vault boot failed', { error: String(err) });
		throw err;
	}

	if (!globalThis.__restauranteer_signals_attached) {
		globalThis.__restauranteer_signals_attached = true;
		for (const sig of ['SIGINT', 'SIGTERM'] as const) {
			process.once(sig, () => {
				log.info(`Received ${sig}, shutting down`);
				shutdownVault()
					.catch((err) => log.error('Shutdown failed', { error: String(err) }))
					.finally(() => process.exit(0));
			});
		}
	}
};

/**
 * Bearer-token guard for `/api/sync/*` (and, with RESTAURANTEER_REQUIRE_AUTH=1,
 * for all of `/api/*`). Everything else passes straight through. See
 * `$lib/server/sync/auth` for the rules.
 */
export const handle = authGuard;

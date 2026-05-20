import type { Handle, ServerInit } from '@sveltejs/kit';
import { bootVault, shutdownVault } from '$lib/server/vault';
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

export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event);
};

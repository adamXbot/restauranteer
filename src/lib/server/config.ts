import { env } from '$env/dynamic/private';
import path from 'node:path';

export const config = {
	vaultPath: env.VAULT_PATH ?? './data',
	vaultSubdir: env.VAULT_SUBDIR ?? 'Restaurants',
	logLevel: env.LOG_LEVEL ?? 'info',
	obsidianVaultName: env.OBSIDIAN_VAULT_NAME ?? ''
};

export function restaurantsDir(): string {
	return path.join(config.vaultPath, config.vaultSubdir);
}

export function listsDir(): string {
	return path.join(restaurantsDir(), '_Lists');
}

export function attachmentsDir(): string {
	return path.join(restaurantsDir(), '_attachments');
}

export function tmpDir(): string {
	return path.join(restaurantsDir(), '.restauranteer-tmp');
}

export function dbPath(): string {
	return path.join(config.vaultPath, '.restauranteer', 'index.db');
}

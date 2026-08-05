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
	// The index is rebuildable, so it has no business inside a *synced*
	// vault: SQLite's WAL churns on every write, and when the vault lives in
	// iCloud Drive (the iOS app's shared-folder topology) that churn becomes
	// endless sync traffic. RESTAURANTEER_INDEX_PATH points it somewhere
	// local; the default stays put for existing deployments.
	const override = (env.RESTAURANTEER_INDEX_PATH ?? '').trim();
	if (override) return override;
	return path.join(config.vaultPath, '.restauranteer', 'index.db');
}

export function preferencesFilePath(): string {
	// Shared with the iOS app (its `PreferencesStore.fileName`): the vault
	// root's `.restauranteer-settings.json`, deliberately *not* inside
	// `.restauranteer/` — that directory is this server's local index home,
	// while the settings file is part of the vault and travels with it.
	return path.join(config.vaultPath, '.restauranteer-settings.json');
}

export function inboxDir(): string {
	// The synced inbox convention the iOS share extension writes
	// (`{vault}/Inbox/*.md`, `kind: restauranteer_inbox`). Outside
	// `Restaurants/`, so the vault scanner never mistakes one for a
	// restaurant.
	return path.join(config.vaultPath, 'Inbox');
}

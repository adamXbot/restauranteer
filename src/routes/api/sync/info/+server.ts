import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/vault/types';
import { ensureVaultId } from '$lib/server/sync/vaultId';
import { SYNC_PROTOCOL_VERSION, SYNC_CAPABILITIES } from '$lib/server/sync/protocol';

/**
 * Pairing handshake. The client stores `vault_id` when it pairs and refuses to
 * sync any server that reports a different one — that is what stops a phone
 * being pointed at the wrong server and silently merging two unrelated vaults.
 */
export const GET: RequestHandler = async () => {
	const vaultId = await ensureVaultId();
	return json(
		{
			app: 'restauranteer',
			vault_id: vaultId,
			schema_version: CURRENT_SCHEMA_VERSION,
			protocol: SYNC_PROTOCOL_VERSION,
			capabilities: SYNC_CAPABILITIES
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};

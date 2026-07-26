/** Wire-protocol constants shared by the sync routes. */

/** Bumped only for a breaking change to the wire format. */
export const SYNC_PROTOCOL_VERSION = 1;

/** Advertised in `GET /api/sync/info` so clients can feature-detect. */
export const SYNC_CAPABILITIES = ['manifest', 'file', 'delete'] as const;

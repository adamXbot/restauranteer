import { env } from '$env/dynamic/private';

export type ImmichSize = 'thumbnail' | 'preview';

export function hasImmich(): boolean {
	return !!env.IMMICH_URL && !!env.IMMICH_API_KEY;
}

/**
 * One asset's thumbnail or preview, fetched with the server's key so the
 * browser never sees it. The key needs Immich's `asset.view` permission.
 */
export async function fetchImmichAsset(
	id: string,
	size: ImmichSize
): Promise<{ status: number; body: ReadableStream<Uint8Array> | null; contentType: string }> {
	const base = (env.IMMICH_URL ?? '').replace(/\/+$/, '');
	const res = await fetch(`${base}/api/assets/${id}/thumbnail?size=${size}`, {
		headers: { 'x-api-key': env.IMMICH_API_KEY ?? '' },
		signal: AbortSignal.timeout(20_000)
	});
	return {
		status: res.status,
		body: res.ok ? res.body : null,
		contentType: res.headers.get('content-type') ?? 'image/jpeg'
	};
}

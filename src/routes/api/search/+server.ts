import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { autocomplete, hasGoogleKey } from '$lib/server/providers/google';
import { searchVaultFts } from '$lib/server/db/queries';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const latStr = url.searchParams.get('lat');
	const lngStr = url.searchParams.get('lng');
	const sessionToken = url.searchParams.get('session') ?? undefined;
	const lat = latStr ? Number(latStr) : NaN;
	const lng = lngStr ? Number(lngStr) : NaN;

	if (!q) return json({ vault: [], google: [], google_enabled: hasGoogleKey() });

	const vault = searchVaultFts(q, 10).map((r) => ({
		uuid: r.uuid,
		name: r.name,
		address: (r.frontmatter.address as string | undefined) ?? null,
		suburb: (r.frontmatter.suburb as string | undefined) ?? null,
		google_place_id: r.google_place_id
	}));
	const knownIds = new Set(vault.map((v) => v.google_place_id).filter(Boolean));

	let google: Awaited<ReturnType<typeof autocomplete>> = [];
	if (hasGoogleKey()) {
		try {
			google = await autocomplete(q, {
				lat: Number.isFinite(lat) ? lat : undefined,
				lng: Number.isFinite(lng) ? lng : undefined,
				sessionToken
			});
			google = google.filter((g) => !knownIds.has(g.place_id));
		} catch (e) {
			log.error('Autocomplete error', { error: String(e) });
		}
	}

	return json({
		vault,
		google,
		google_enabled: hasGoogleKey()
	});
};

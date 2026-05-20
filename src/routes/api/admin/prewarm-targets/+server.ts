import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllRestaurants } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import { extractImagePaths } from '$lib/server/vault/visit';
import { hasGoogleKey, placeDetails } from '$lib/server/providers/google';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ url }) => {
	const includePhotos = url.searchParams.get('photos') !== '0';
	const restaurants = getAllRestaurants();
	const pageData: string[] = [];
	const attachments: string[] = [];
	const photos: string[] = [];
	const useGoogle = includePhotos && hasGoogleKey();
	let googleFetches = 0;

	for (const r of restaurants) {
		pageData.push(`/restaurant/${r.uuid}/__data.json`);

		const file = await readRestaurant(r.file_path).catch(() => null);
		if (file) {
			for (const p of extractImagePaths(file.body)) {
				if (p.startsWith('_attachments/')) {
					attachments.push(`/api/attachments/${p.slice('_attachments/'.length)}`);
				}
			}
		}

		if (useGoogle && r.google_place_id) {
			try {
				const d = await placeDetails(r.google_place_id);
				googleFetches++;
				const first = d.photos[0];
				if (first) {
					photos.push(`/api/photos?name=${encodeURIComponent(first.name)}&w=800`);
				}
			} catch (e) {
				log.error('prewarm placeDetails failed', { uuid: r.uuid, error: String(e) });
			}
		}
	}

	return json({
		restaurants: restaurants.length,
		google_fetches: googleFetches,
		pageData,
		attachments,
		photos,
		total: pageData.length + attachments.length + photos.length
	});
};

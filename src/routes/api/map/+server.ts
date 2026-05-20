import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db/schema';

type Row = {
	uuid: string;
	name: string;
	lat: number;
	lng: number;
	suburb: string | null;
	address: string | null;
	rating: number | null;
	cuisine_json: string | null;
};

function parseCuisine(json: string | null): string[] {
	if (!json) return [];
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

export const GET: RequestHandler = ({ url }) => {
	const bbox = url.searchParams.get('bbox');
	const db = getDb();

	let rows: Row[];
	if (bbox) {
		const parts = bbox.split(',').map(Number);
		if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
			return json({ pins: [], error: 'invalid bbox' }, { status: 400 });
		}
		const [swLat, swLng, neLat, neLng] = parts;
		rows = db
			.prepare(
				`SELECT uuid, name, lat, lng,
				        json_extract(frontmatter_json, '$.suburb') AS suburb,
				        json_extract(frontmatter_json, '$.address') AS address,
				        json_extract(frontmatter_json, '$.rating') AS rating,
				        json_extract(frontmatter_json, '$.cuisine') AS cuisine_json
				 FROM restaurants
				 WHERE lat IS NOT NULL AND lng IS NOT NULL
				   AND lat BETWEEN ? AND ?
				   AND lng BETWEEN ? AND ?
				 LIMIT 2000`
			)
			.all(swLat, neLat, swLng, neLng) as Row[];
	} else {
		rows = db
			.prepare(
				`SELECT uuid, name, lat, lng,
				        json_extract(frontmatter_json, '$.suburb') AS suburb,
				        json_extract(frontmatter_json, '$.address') AS address,
				        json_extract(frontmatter_json, '$.rating') AS rating,
				        json_extract(frontmatter_json, '$.cuisine') AS cuisine_json
				 FROM restaurants
				 WHERE lat IS NOT NULL AND lng IS NOT NULL
				 LIMIT 2000`
			)
			.all() as Row[];
	}

	return json({
		pins: rows.map((r) => ({
			uuid: r.uuid,
			name: r.name,
			lat: r.lat,
			lng: r.lng,
			suburb: r.suburb,
			address: r.address,
			rating: typeof r.rating === 'number' ? r.rating : null,
			cuisine: parseCuisine(r.cuisine_json)
		}))
	});
};

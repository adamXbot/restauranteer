import { env } from '$env/dynamic/private';
import { log } from '../log';
import { CACHE_FOREVER, fetchCached } from './cache';

const BASE = 'https://places.googleapis.com/v1';
// Cache Google Place Details forever — user explicitly refreshes via the UI.
const DETAILS_TTL_SECONDS = CACHE_FOREVER;

export function hasGoogleKey(): boolean {
	return !!env.GOOGLE_PLACES_API_KEY;
}

function apiKey(): string {
	const k = env.GOOGLE_PLACES_API_KEY;
	if (!k) throw new Error('GOOGLE_PLACES_API_KEY is not configured');
	return k;
}

export type AutocompletePrediction = {
	place_id: string;
	text: string;
	primary_text: string;
	secondary_text: string;
};

export async function autocomplete(
	input: string,
	options: { lat?: number; lng?: number; sessionToken?: string } = {}
): Promise<AutocompletePrediction[]> {
	if (input.trim().length < 2) return [];

	const body: Record<string, unknown> = {
		input,
		regionCode: 'AU',
		includedPrimaryTypes: ['restaurant', 'cafe', 'bakery', 'bar', 'meal_takeaway', 'food']
	};
	if (options.lat != null && options.lng != null) {
		body.locationBias = {
			circle: {
				center: { latitude: options.lat, longitude: options.lng },
				radius: 50_000
			}
		};
	}
	if (options.sessionToken) body.sessionToken = options.sessionToken;

	const res = await fetch(`${BASE}/places:autocomplete`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Goog-Api-Key': apiKey()
		},
		body: JSON.stringify(body)
	});

	if (!res.ok) {
		const text = await res.text();
		log.error('Google autocomplete failed', { status: res.status, body: text });
		throw new Error(`Google autocomplete failed: ${res.status}`);
	}

	const data = (await res.json()) as { suggestions?: AutocompleteSuggestion[] };
	return (data.suggestions ?? [])
		.filter((s) => s.placePrediction)
		.map((s) => {
			const p = s.placePrediction!;
			return {
				place_id: p.placeId,
				text: p.text?.text ?? '',
				primary_text: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
				secondary_text: p.structuredFormat?.secondaryText?.text ?? ''
			};
		});
}

export type PlaceReview = {
	author: string;
	author_photo: string | null;
	rating: number;
	relative_time: string;
	text: string;
};

export type PlacePhoto = {
	name: string;
	width: number;
	height: number;
	attributions: string[];
};

export type PlaceDetails = {
	id: string;
	name: string;
	address: string | null;
	lat: number | null;
	lng: number | null;
	phone: string | null;
	international_phone: string | null;
	website: string | null;
	price_level: number | null;
	rating: number | null;
	user_rating_count: number | null;
	types: string[];
	hours: Record<string, string> | null;
	weekday_descriptions: string[];
	reviews: PlaceReview[];
	photos: PlacePhoto[];
	google_maps_uri: string | null;
};

const DETAILS_FIELDS = [
	'id',
	'displayName',
	'formattedAddress',
	'location',
	'nationalPhoneNumber',
	'internationalPhoneNumber',
	'websiteUri',
	'regularOpeningHours',
	'priceLevel',
	'rating',
	'userRatingCount',
	'reviews',
	'photos',
	'types',
	'googleMapsUri'
].join(',');

export type NearbyResult = {
	place_id: string;
	name: string;
	address: string | null;
	lat: number;
	lng: number;
	rating: number | null;
	user_rating_count: number | null;
	types: string[];
	price_level: number | null;
	photo_name: string | null;
};

const NEARBY_FIELDS = [
	'places.id',
	'places.displayName',
	'places.formattedAddress',
	'places.location',
	'places.rating',
	'places.userRatingCount',
	'places.types',
	'places.priceLevel',
	'places.photos'
].join(',');

export async function nearbySearch(
	lat: number,
	lng: number,
	radiusMeters: number,
	options: {
		includedTypes?: string[];
		maxResults?: number;
		forceRefresh?: boolean;
	} = {}
): Promise<NearbyResult[]> {
	const safeRadius = Math.max(1, Math.min(radiusMeters, 50_000));
	const types = options.includedTypes ?? ['restaurant'];
	const maxResults = Math.max(1, Math.min(options.maxResults ?? 20, 20));
	const key = `${lat.toFixed(4)}|${lng.toFixed(4)}|${Math.round(safeRadius)}|${types
		.slice()
		.sort()
		.join(',')}|${maxResults}`;
	return fetchCached<NearbyResult[]>(
		'google.nearby',
		key,
		CACHE_FOREVER,
		async () => {
			const body: Record<string, unknown> = {
				includedTypes: types,
				maxResultCount: maxResults,
				rankPreference: 'DISTANCE',
				locationRestriction: {
					circle: {
						center: { latitude: lat, longitude: lng },
						radius: safeRadius
					}
				},
				regionCode: 'AU'
			};
			const res = await fetch(`${BASE}/places:searchNearby`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Goog-Api-Key': apiKey(),
					'X-Goog-FieldMask': NEARBY_FIELDS
				},
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const text = await res.text();
				log.error('Nearby search failed', { status: res.status, body: text });
				throw new Error(`Nearby search failed: ${res.status}`);
			}
			const data = (await res.json()) as { places?: NearbyRaw[] };
			return (data.places ?? []).map((p) => ({
				place_id: p.id ?? '',
				name: p.displayName?.text ?? '',
				address: p.formattedAddress ?? null,
				lat: p.location?.latitude ?? 0,
				lng: p.location?.longitude ?? 0,
				rating: typeof p.rating === 'number' ? p.rating : null,
				user_rating_count: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
				types: Array.isArray(p.types) ? p.types : [],
				price_level: parsePriceLevel(p.priceLevel),
				photo_name: p.photos?.[0]?.name ?? null
			}));
		},
		{ forceRefresh: options.forceRefresh }
	);
}

type NearbyRaw = {
	id?: string;
	displayName?: { text?: string };
	formattedAddress?: string;
	location?: { latitude?: number; longitude?: number };
	rating?: number;
	userRatingCount?: number;
	types?: string[];
	priceLevel?: string;
	photos?: Array<{ name?: string }>;
};

export async function findPlaceByText(
	query: string,
	options: { lat?: number; lng?: number; radiusMeters?: number } = {}
): Promise<string | null> {
	if (!query.trim()) return null;
	const body: Record<string, unknown> = {
		textQuery: query,
		regionCode: 'AU',
		maxResultCount: 1
	};
	if (options.lat != null && options.lng != null) {
		body.locationBias = {
			circle: {
				center: { latitude: options.lat, longitude: options.lng },
				radius: options.radiusMeters ?? 500
			}
		};
	}
	const res = await fetch(`${BASE}/places:searchText`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Goog-Api-Key': apiKey(),
			'X-Goog-FieldMask': 'places.id'
		},
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const text = await res.text();
		log.error('Find place failed', { status: res.status, body: text, query });
		throw new Error(`Find place failed: ${res.status}`);
	}
	const data = (await res.json()) as { places?: Array<{ id?: string }> };
	const id = data.places?.[0]?.id;
	return id ?? null;
}

export type PlaceCandidate = {
	place_id: string;
	name: string;
	address: string | null;
	lat: number | null;
	lng: number | null;
};

const TEXT_SEARCH_FIELDS = [
	'places.id',
	'places.displayName',
	'places.formattedAddress',
	'places.location'
].join(',');

export async function searchPlacesByText(
	query: string,
	options: { lat?: number; lng?: number; radiusMeters?: number; maxResults?: number } = {}
): Promise<PlaceCandidate[]> {
	if (!query.trim()) return [];
	const maxResults = Math.max(1, Math.min(options.maxResults ?? 8, 20));
	const body: Record<string, unknown> = {
		textQuery: query,
		regionCode: 'AU',
		maxResultCount: maxResults
	};
	if (options.lat != null && options.lng != null) {
		body.locationBias = {
			circle: {
				center: { latitude: options.lat, longitude: options.lng },
				radius: options.radiusMeters ?? 5_000
			}
		};
	}
	const res = await fetch(`${BASE}/places:searchText`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Goog-Api-Key': apiKey(),
			'X-Goog-FieldMask': TEXT_SEARCH_FIELDS
		},
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const text = await res.text();
		log.error('Text search failed', { status: res.status, body: text, query });
		throw new Error(`Text search failed: ${res.status}`);
	}
	const data = (await res.json()) as {
		places?: Array<{
			id?: string;
			displayName?: { text?: string };
			formattedAddress?: string;
			location?: { latitude?: number; longitude?: number };
		}>;
	};
	return (data.places ?? [])
		.filter((p) => p.id)
		.map((p) => ({
			place_id: p.id!,
			name: p.displayName?.text ?? '',
			address: p.formattedAddress ?? null,
			lat: p.location?.latitude ?? null,
			lng: p.location?.longitude ?? null
		}));
}

export async function placeDetails(
	placeId: string,
	options: { forceRefresh?: boolean } = {}
): Promise<PlaceDetails> {
	return fetchCached(
		'google.place',
		placeId,
		DETAILS_TTL_SECONDS,
		async () => {
			const res = await fetch(`${BASE}/places/${encodeURIComponent(placeId)}`, {
				headers: {
					'X-Goog-Api-Key': apiKey(),
					'X-Goog-FieldMask': DETAILS_FIELDS
				}
			});
			if (!res.ok) {
				const text = await res.text();
				log.error('Google details failed', { status: res.status, body: text, placeId });
				throw new Error(`Google details failed: ${res.status}`);
			}
			const p = (await res.json()) as RawPlaceResponse;
			return mapPlace(p, placeId);
		},
		options
	);
}

export async function fetchPhoto(
	name: string,
	width: number
): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string }> {
	const safeWidth = Math.max(64, Math.min(width, 4800));
	const url = `${BASE}/${name}/media?maxWidthPx=${safeWidth}&key=${apiKey()}`;
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok) {
		throw new Error(`Photo fetch failed: ${res.status}`);
	}
	return {
		body: res.body,
		contentType: res.headers.get('content-type') ?? 'image/jpeg'
	};
}

export function photoProxyUrl(name: string, width = 800): string {
	return `/api/photos?name=${encodeURIComponent(name)}&w=${width}`;
}

type AutocompleteSuggestion = {
	placePrediction?: {
		placeId: string;
		text?: { text?: string };
		structuredFormat?: {
			mainText?: { text?: string };
			secondaryText?: { text?: string };
		};
	};
};

type RawPlaceResponse = {
	id?: string;
	displayName?: { text?: string };
	formattedAddress?: string;
	location?: { latitude?: number; longitude?: number };
	nationalPhoneNumber?: string;
	internationalPhoneNumber?: string;
	websiteUri?: string;
	regularOpeningHours?: { weekdayDescriptions?: string[] };
	priceLevel?: string;
	rating?: number;
	userRatingCount?: number;
	reviews?: Array<{
		authorAttribution?: { displayName?: string; photoUri?: string };
		rating?: number;
		relativePublishTimeDescription?: string;
		text?: { text?: string };
		originalText?: { text?: string };
	}>;
	photos?: Array<{
		name?: string;
		widthPx?: number;
		heightPx?: number;
		authorAttributions?: Array<{ displayName?: string }>;
	}>;
	types?: string[];
	googleMapsUri?: string;
};

function mapPlace(p: RawPlaceResponse, fallbackId: string): PlaceDetails {
	const weekdayDescriptions = p.regularOpeningHours?.weekdayDescriptions ?? [];
	return {
		id: p.id ?? fallbackId,
		name: p.displayName?.text ?? '',
		address: p.formattedAddress ?? null,
		lat: p.location?.latitude ?? null,
		lng: p.location?.longitude ?? null,
		phone: p.nationalPhoneNumber ?? null,
		international_phone: p.internationalPhoneNumber ?? null,
		website: p.websiteUri ?? null,
		price_level: parsePriceLevel(p.priceLevel),
		rating: typeof p.rating === 'number' ? p.rating : null,
		user_rating_count: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
		types: Array.isArray(p.types) ? p.types : [],
		hours: parseHours(weekdayDescriptions),
		weekday_descriptions: weekdayDescriptions,
		reviews: (p.reviews ?? []).map((r) => ({
			author: r.authorAttribution?.displayName ?? 'Anonymous',
			author_photo: r.authorAttribution?.photoUri ?? null,
			rating: typeof r.rating === 'number' ? r.rating : 0,
			relative_time: r.relativePublishTimeDescription ?? '',
			text: r.text?.text ?? r.originalText?.text ?? ''
		})),
		photos: (p.photos ?? [])
			.filter((ph): ph is { name: string; widthPx?: number; heightPx?: number; authorAttributions?: Array<{ displayName?: string }> } => !!ph.name)
			.map((ph) => ({
				name: ph.name,
				width: ph.widthPx ?? 0,
				height: ph.heightPx ?? 0,
				attributions: (ph.authorAttributions ?? []).map((a) => a.displayName ?? '')
			})),
		google_maps_uri: p.googleMapsUri ?? null
	};
}

function parsePriceLevel(level?: string): number | null {
	if (!level) return null;
	const map: Record<string, number> = {
		PRICE_LEVEL_FREE: 0,
		PRICE_LEVEL_INEXPENSIVE: 1,
		PRICE_LEVEL_MODERATE: 2,
		PRICE_LEVEL_EXPENSIVE: 3,
		PRICE_LEVEL_VERY_EXPENSIVE: 4
	};
	return map[level] ?? null;
}

const DAY_MAP: Record<string, string> = {
	monday: 'mon',
	tuesday: 'tue',
	wednesday: 'wed',
	thursday: 'thu',
	friday: 'fri',
	saturday: 'sat',
	sunday: 'sun'
};

function parseHours(descriptions: string[]): Record<string, string> | null {
	if (!descriptions || descriptions.length === 0) return null;
	const out: Record<string, string> = {};
	for (const line of descriptions) {
		const idx = line.indexOf(':');
		if (idx < 0) continue;
		const dayName = line.slice(0, idx).trim().toLowerCase();
		const time = line.slice(idx + 1).trim();
		const key = DAY_MAP[dayName] ?? dayName.slice(0, 3);
		out[key] = time;
	}
	return Object.keys(out).length > 0 ? out : null;
}

const CUISINE_LABEL: Record<string, string> = {
	italian_restaurant: 'Italian',
	french_restaurant: 'French',
	japanese_restaurant: 'Japanese',
	chinese_restaurant: 'Chinese',
	korean_restaurant: 'Korean',
	vietnamese_restaurant: 'Vietnamese',
	thai_restaurant: 'Thai',
	indian_restaurant: 'Indian',
	mexican_restaurant: 'Mexican',
	mediterranean_restaurant: 'Mediterranean',
	greek_restaurant: 'Greek',
	american_restaurant: 'American',
	steak_house: 'Steakhouse',
	seafood_restaurant: 'Seafood',
	sushi_restaurant: 'Sushi',
	ramen_restaurant: 'Ramen',
	pizza_restaurant: 'Pizza',
	hamburger_restaurant: 'Burgers',
	vegan_restaurant: 'Vegan',
	vegetarian_restaurant: 'Vegetarian',
	cafe: 'Café',
	bakery: 'Bakery',
	bar: 'Bar',
	wine_bar: 'Wine bar',
	pub: 'Pub',
	dessert_shop: 'Dessert',
	ice_cream_shop: 'Ice cream'
};

export function cuisinesFromTypes(types: string[]): string[] {
	const out = new Set<string>();
	for (const t of types) {
		const label = CUISINE_LABEL[t];
		if (label) out.add(label);
	}
	return [...out];
}

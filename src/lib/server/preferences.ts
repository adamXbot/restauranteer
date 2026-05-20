import { getMeta, setMeta } from './db/schema';

export type NavigationApp = 'apple' | 'google';
export type MapProvider = 'mapbox' | 'apple' | 'google';
export type ShareFormat = 'full' | 'notes_only';

const MAP_PROVIDERS: MapProvider[] = ['mapbox', 'apple', 'google'];
const SHARE_FORMATS: ShareFormat[] = ['full', 'notes_only'];

export type Preferences = {
	per_area_ratings: boolean;
	default_navigation_app: NavigationApp;
	default_map_provider: MapProvider;
	share_format: ShareFormat;
	/**
	 * Surface AU-only publications (Broadsheet, Good Food, AGFG, Time Out
	 * Australia) in the Discover UI. When off, only generic global inputs
	 * (Google Maps / Apple Maps URL paste, markdown import, GitHub sync) are
	 * shown.
	 */
	australian_centric: boolean;
	show_review_summary: boolean;
};

const DEFAULTS: Preferences = {
	per_area_ratings: false,
	default_navigation_app: 'apple',
	default_map_provider: 'mapbox',
	share_format: 'full',
	australian_centric: true,
	show_review_summary: true
};

const KEY = 'preferences';

function coerceNavApp(v: unknown): NavigationApp {
	return v === 'google' ? 'google' : 'apple';
}

function coerceMapProvider(v: unknown): MapProvider {
	return MAP_PROVIDERS.includes(v as MapProvider) ? (v as MapProvider) : 'mapbox';
}

function coerceShareFormat(v: unknown): ShareFormat {
	return SHARE_FORMATS.includes(v as ShareFormat) ? (v as ShareFormat) : 'full';
}

export function getPreferences(): Preferences {
	const raw = getMeta(KEY);
	if (!raw) return { ...DEFAULTS };
	try {
		const parsed = JSON.parse(raw) as Partial<Preferences>;
		return {
			per_area_ratings: parsed.per_area_ratings === true,
			default_navigation_app: coerceNavApp(parsed.default_navigation_app),
			default_map_provider: coerceMapProvider(parsed.default_map_provider),
			share_format: coerceShareFormat(parsed.share_format),
			australian_centric:
				parsed.australian_centric === undefined
					? DEFAULTS.australian_centric
					: parsed.australian_centric === true,
			show_review_summary:
				parsed.show_review_summary === undefined
					? DEFAULTS.show_review_summary
					: parsed.show_review_summary === true
		};
	} catch {
		return { ...DEFAULTS };
	}
}

export function setPreferences(updates: Partial<Preferences>): Preferences {
	const current = getPreferences();
	const merged: Preferences = {
		per_area_ratings:
			updates.per_area_ratings !== undefined
				? updates.per_area_ratings === true
				: current.per_area_ratings,
		default_navigation_app:
			updates.default_navigation_app !== undefined
				? coerceNavApp(updates.default_navigation_app)
				: current.default_navigation_app,
		default_map_provider:
			updates.default_map_provider !== undefined
				? coerceMapProvider(updates.default_map_provider)
				: current.default_map_provider,
		share_format:
			updates.share_format !== undefined
				? coerceShareFormat(updates.share_format)
				: current.share_format,
		australian_centric:
			updates.australian_centric !== undefined
				? updates.australian_centric === true
				: current.australian_centric,
		show_review_summary:
			updates.show_review_summary !== undefined
				? updates.show_review_summary === true
				: current.show_review_summary
	};
	setMeta(KEY, JSON.stringify(merged));
	return merged;
}

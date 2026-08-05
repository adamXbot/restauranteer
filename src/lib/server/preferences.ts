import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { getMeta, setMeta } from './db/schema';
import { preferencesFilePath } from './config';
import {
	DEFAULT_THEME_PREFERENCES,
	coerceThemeMode,
	coerceThemePreset,
	normalizeHexAccent,
	type ThemeMode,
	type ThemePresetId
} from '$lib/theme';
import { coerceAttributeDefinitions, type AttributeDefinition } from '$lib/attributes';

export type NavigationApp = 'apple' | 'google';
export type MapProvider = 'mapbox' | 'apple' | 'google';
export type ShareFormat = 'full' | 'notes_only';

const MAP_PROVIDERS: MapProvider[] = ['mapbox', 'apple', 'google'];
const SHARE_FORMATS: ShareFormat[] = ['full', 'notes_only'];

export type Preferences = {
	per_area_ratings: boolean;
	/**
	 * Allow breaking the Food area into individually-rated dishes. Only takes
	 * effect alongside `per_area_ratings`, since the dish average drives the
	 * Food area rating.
	 */
	food_breakdown: boolean;
	/**
	 * Show per-dish photos as small thumbnails on the restaurant page by default
	 * (they also appear in "Your photos"). Overridable per page via a toggle.
	 */
	collapse_dish_photos: boolean;
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
	theme_mode: ThemeMode;
	theme_preset: ThemePresetId;
	theme_accent: string | null;
	attributes: AttributeDefinition[];
};

const DEFAULTS: Preferences = {
	per_area_ratings: false,
	food_breakdown: false,
	collapse_dish_photos: true,
	default_navigation_app: 'apple',
	default_map_provider: 'mapbox',
	share_format: 'full',
	australian_centric: true,
	show_review_summary: true,
	attributes: [],
	...DEFAULT_THEME_PREFERENCES
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

export function parsePreferences(raw: string | null): Preferences {
	if (!raw) return { ...DEFAULTS, attributes: [] };
	try {
		const parsed = JSON.parse(raw) as Partial<Preferences>;
		return {
			per_area_ratings: parsed.per_area_ratings === true,
			food_breakdown: parsed.food_breakdown === true,
			collapse_dish_photos:
				parsed.collapse_dish_photos === undefined
					? DEFAULTS.collapse_dish_photos
					: parsed.collapse_dish_photos === true,
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
					: parsed.show_review_summary === true,
			theme_mode: coerceThemeMode(parsed.theme_mode),
			theme_preset: coerceThemePreset(parsed.theme_preset),
			theme_accent: normalizeHexAccent(parsed.theme_accent),
			attributes: coerceAttributeDefinitions(parsed.attributes)
		};
	} catch {
		return { ...DEFAULTS, attributes: [] };
	}
}

/**
 * Raw bytes of the shared settings file, or null. The file
 * (`{vault}/.restauranteer-settings.json`) is the canonical store since the
 * iOS app began writing it — SQLite meta remains as the pre-adoption
 * fallback and is kept in step on every write, so a rollback of this code
 * loses nothing.
 */
function rawSettingsFile(): string | null {
	try {
		return readFileSync(preferencesFilePath(), 'utf8');
	} catch {
		return null;
	}
}

export function getPreferences(): Preferences {
	return parsePreferences(rawSettingsFile() ?? getMeta(KEY));
}

export function setPreferences(updates: Partial<Preferences>): Preferences {
	const current = getPreferences();
	const merged: Preferences = {
		per_area_ratings:
			updates.per_area_ratings !== undefined
				? updates.per_area_ratings === true
				: current.per_area_ratings,
		food_breakdown:
			updates.food_breakdown !== undefined
				? updates.food_breakdown === true
				: current.food_breakdown,
		collapse_dish_photos:
			updates.collapse_dish_photos !== undefined
				? updates.collapse_dish_photos === true
				: current.collapse_dish_photos,
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
				: current.show_review_summary,
		theme_mode:
			updates.theme_mode !== undefined ? coerceThemeMode(updates.theme_mode) : current.theme_mode,
		theme_preset:
			updates.theme_preset !== undefined
				? coerceThemePreset(updates.theme_preset)
				: current.theme_preset,
		theme_accent:
			updates.theme_accent !== undefined
				? normalizeHexAccent(updates.theme_accent)
				: current.theme_accent,
		attributes:
			updates.attributes !== undefined
				? coerceAttributeDefinitions(updates.attributes)
				: current.attributes
	};
	writeSettingsFile(merged);
	setMeta(KEY, JSON.stringify(merged));
	return merged;
}

/**
 * Write the shared settings file, carrying through any top-level keys this
 * server does not know — the iOS store does the same in reverse, so a newer
 * peer's keys survive a round-trip through an older one. Atomic via
 * temp-file + rename; the temp name is dot-prefixed, which every scanner in
 * both apps already ignores.
 */
function writeSettingsFile(merged: Preferences): void {
	let unknown: Record<string, unknown> = {};
	const raw = rawSettingsFile();
	if (raw) {
		try {
			const existing = JSON.parse(raw) as Record<string, unknown>;
			const known = new Set(Object.keys(merged));
			for (const [key, value] of Object.entries(existing)) {
				if (!known.has(key)) unknown[key] = value;
			}
		} catch {
			// Corrupt file: overwrite with known-good content, dropping nothing
			// parseable — there was nothing parseable.
			unknown = {};
		}
	}
	const target = preferencesFilePath();
	const temp = `${target}.tmp-${process.pid}`;
	try {
		writeFileSync(temp, JSON.stringify({ ...merged, ...unknown }, null, 2) + '\n', 'utf8');
		renameSync(temp, target);
	} catch {
		// Vault not writable (read-only mount, missing dir): meta still has
		// the truth, and the next successful write catches the file up.
	}
}

/**
 * One-time adoption: a deployment that predates the shared file gets its
 * meta-stored preferences written out, so the iOS app sees them the moment
 * the folders are shared. Called at inbox/settings load; cheap no-op once
 * the file exists.
 */
export function adoptSettingsFileIfMissing(): void {
	if (existsSync(preferencesFilePath())) return;
	const meta = getMeta(KEY);
	if (!meta) return;
	writeSettingsFile(parsePreferences(meta));
}

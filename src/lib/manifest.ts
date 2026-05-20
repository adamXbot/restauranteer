import {
	buildThemeColors,
	coerceThemeMode,
	coerceThemePreset,
	normalizeHexAccent,
	resolveBrightness,
	type ThemeBrightness,
	type ThemePreferences
} from '$lib/theme';

export type WebManifest = {
	name: string;
	short_name: string;
	description: string;
	theme_color: string;
	background_color: string;
	display: string;
	orientation: string;
	start_url: string;
	scope: string;
	share_target: {
		action: string;
		method: string;
		params: { url: string; title: string; text: string };
	};
	icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
};

export function themePreferencesFromSearchParams(params: URLSearchParams): ThemePreferences {
	return {
		theme_mode: coerceThemeMode(params.get('mode')),
		theme_preset: coerceThemePreset(params.get('preset')),
		theme_accent: normalizeHexAccent(params.get('accent'))
	};
}

export function manifestBrightnessFromSearchParams(
	params: URLSearchParams,
	preferences: ThemePreferences
): ThemeBrightness {
	const brightness = params.get('brightness');
	if (brightness === 'light' || brightness === 'dark') return brightness;
	return resolveBrightness(preferences.theme_mode, true);
}

export function buildWebManifest(
	preferences: ThemePreferences,
	brightness: ThemeBrightness
): WebManifest {
	const colors = buildThemeColors(preferences, brightness);
	return {
		name: 'Restauranteer',
		short_name: 'Restauranteer',
		description: 'Your pocket restaurant companion',
		theme_color: colors.canvas,
		background_color: colors.canvas,
		display: 'standalone',
		orientation: 'portrait',
		start_url: '/',
		scope: '/',
		share_target: {
			action: '/inbox',
			method: 'GET',
			params: { url: 'url', title: 'title', text: 'text' }
		},
		icons: [
			{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
			{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
			{
				src: '/icons/icon-maskable-192.png',
				sizes: '192x192',
				type: 'image/png',
				purpose: 'maskable'
			},
			{
				src: '/icons/icon-maskable-512.png',
				sizes: '512x512',
				type: 'image/png',
				purpose: 'maskable'
			}
		]
	};
}

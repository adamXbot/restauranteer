import {
	buildManifestHref,
	buildThemeColors,
	buildThemeCssVariables,
	resolveBrightness,
	type ThemeBrightness,
	type ThemeColors,
	type ThemePreferences
} from '$lib/theme';

export const THEME_STORAGE_KEY = 'restauranteer.theme';

export type RuntimeTheme = {
	theme: ThemePreferences['theme_preset'];
	mode: ThemePreferences['theme_mode'];
	brightness: ThemeBrightness;
	colors: ThemeColors;
	variables: Record<string, string>;
	manifestHref: string;
	themeColor: string;
	statusBarStyle: 'default' | 'black-translucent';
};

export function buildRuntimeTheme(
	preferences: ThemePreferences,
	prefersDark = prefersDarkScheme()
): RuntimeTheme {
	const brightness = resolveBrightness(preferences.theme_mode, prefersDark);
	const colors = buildThemeColors(preferences, brightness);
	return {
		theme: preferences.theme_preset,
		mode: preferences.theme_mode,
		brightness,
		colors,
		variables: buildThemeCssVariables(colors),
		manifestHref: buildManifestHref(preferences, brightness),
		themeColor: colors.canvas,
		statusBarStyle: brightness === 'dark' ? 'black-translucent' : 'default'
	};
}

export function applyTheme(preferences: ThemePreferences): RuntimeTheme {
	const runtime = buildRuntimeTheme(preferences);
	applyRuntimeTheme(runtime);
	return runtime;
}

export function installTheme(preferences: ThemePreferences): () => void {
	if (typeof window === 'undefined') return () => {};
	const media = window.matchMedia('(prefers-color-scheme: dark)');
	const apply = () => applyTheme(preferences);
	apply();
	media.addEventListener('change', apply);
	return () => media.removeEventListener('change', apply);
}

export function applyRuntimeTheme(runtime: RuntimeTheme): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	root.dataset.theme = runtime.theme;
	root.dataset.themeMode = runtime.mode;
	root.dataset.brightness = runtime.brightness;
	root.style.colorScheme = runtime.brightness;
	for (const [name, value] of Object.entries(runtime.variables)) {
		root.style.setProperty(name, value);
	}
	setMeta('theme-color', runtime.themeColor);
	setMeta('apple-mobile-web-app-status-bar-style', runtime.statusBarStyle);
	setManifestHref(runtime.manifestHref);
	try {
		localStorage.setItem(
			THEME_STORAGE_KEY,
			JSON.stringify({
				theme: runtime.theme,
				mode: runtime.mode,
				brightness: runtime.brightness,
				variables: runtime.variables,
				manifestHref: runtime.manifestHref,
				themeColor: runtime.themeColor,
				statusBarStyle: runtime.statusBarStyle
			})
		);
	} catch {
		// localStorage may be blocked; runtime theme application still works.
	}
	document.dispatchEvent(new CustomEvent('restauranteer-themechange', { detail: runtime }));
}

function prefersDarkScheme(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function setMeta(name: string, content: string): void {
	let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
	if (!meta) {
		meta = document.createElement('meta');
		meta.name = name;
		document.head.append(meta);
	}
	meta.content = content;
}

function setManifestHref(href: string): void {
	let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
	if (!link) {
		link = document.createElement('link');
		link.rel = 'manifest';
		document.head.append(link);
	}
	link.href = href;
}

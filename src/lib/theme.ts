export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeBrightness = 'light' | 'dark';
export type ThemePresetId = 'ember' | 'basil' | 'saffron' | 'plum' | 'tide';

export type ThemePreferences = {
	theme_mode: ThemeMode;
	theme_preset: ThemePresetId;
	theme_accent: string | null;
};

type NeutralTokens = {
	canvas: string;
	panel: string;
	panel2: string;
	panel3: string;
	line: string;
	lineStrong: string;
	text: string;
	textSoft: string;
	textMuted: string;
	overlay: string;
	rating: string;
	success: string;
	warning: string;
	danger: string;
	mapSecondary: string;
};

export type ThemeColors = NeutralTokens & {
	accent: string;
	accentSoft: string;
	accentStrong: string;
	accentRing: string;
	onAccent: string;
};

export type ThemePreset = {
	id: ThemePresetId;
	label: string;
	accent: string;
	light: NeutralTokens;
	dark: NeutralTokens;
};

export const THEME_PRESET_IDS: ThemePresetId[] = ['ember', 'basil', 'saffron', 'plum', 'tide'];
export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark'];

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
	theme_mode: 'system',
	theme_preset: 'ember',
	theme_accent: null
};

export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
	ember: {
		id: 'ember',
		label: 'Ember',
		accent: '#e6794a',
		dark: {
			canvas: '#020617',
			panel: '#0f172a',
			panel2: '#1e293b',
			panel3: '#334155',
			line: '#1e293b',
			lineStrong: '#334155',
			text: '#f8fafc',
			textSoft: '#cbd5e1',
			textMuted: '#94a3b8',
			overlay: 'rgb(2 6 23 / 0.72)',
			rating: '#fcd34d',
			success: '#34d399',
			warning: '#f59e0b',
			danger: '#f87171',
			mapSecondary: '#64748b'
		},
		light: {
			canvas: '#f8fafc',
			panel: '#ffffff',
			panel2: '#f1f5f9',
			panel3: '#e2e8f0',
			line: '#e2e8f0',
			lineStrong: '#cbd5e1',
			text: '#0f172a',
			textSoft: '#334155',
			textMuted: '#64748b',
			overlay: 'rgb(15 23 42 / 0.38)',
			rating: '#b45309',
			success: '#047857',
			warning: '#b45309',
			danger: '#dc2626',
			mapSecondary: '#64748b'
		}
	},
	basil: {
		id: 'basil',
		label: 'Basil',
		accent: '#4f9f67',
		dark: {
			canvas: '#07110d',
			panel: '#0f1f18',
			panel2: '#1a3328',
			panel3: '#264536',
			line: '#1d352a',
			lineStrong: '#315644',
			text: '#f3faf6',
			textSoft: '#c9ddd1',
			textMuted: '#8faf9c',
			overlay: 'rgb(5 12 9 / 0.72)',
			rating: '#facc15',
			success: '#45d483',
			warning: '#f59e0b',
			danger: '#fb7185',
			mapSecondary: '#5f7f70'
		},
		light: {
			canvas: '#f7faf4',
			panel: '#ffffff',
			panel2: '#edf4e8',
			panel3: '#dde9d7',
			line: '#d8e5d1',
			lineStrong: '#b8cdb0',
			text: '#132016',
			textSoft: '#304533',
			textMuted: '#657766',
			overlay: 'rgb(19 32 22 / 0.36)',
			rating: '#a16207',
			success: '#047857',
			warning: '#b45309',
			danger: '#dc2626',
			mapSecondary: '#6f806c'
		}
	},
	saffron: {
		id: 'saffron',
		label: 'Saffron',
		accent: '#d9901f',
		dark: {
			canvas: '#11100a',
			panel: '#1d1a12',
			panel2: '#2f2a1d',
			panel3: '#423926',
			line: '#332d1e',
			lineStrong: '#574b30',
			text: '#fbf8ef',
			textSoft: '#ded3b8',
			textMuted: '#afa17f',
			overlay: 'rgb(17 16 10 / 0.72)',
			rating: '#fde047',
			success: '#4ade80',
			warning: '#f59e0b',
			danger: '#fb7185',
			mapSecondary: '#85775b'
		},
		light: {
			canvas: '#fbf8f0',
			panel: '#ffffff',
			panel2: '#f4ecdd',
			panel3: '#eadcc4',
			line: '#e5d7bd',
			lineStrong: '#ceb993',
			text: '#251a0b',
			textSoft: '#4d3b1d',
			textMuted: '#7b6a4a',
			overlay: 'rgb(37 26 11 / 0.36)',
			rating: '#a16207',
			success: '#047857',
			warning: '#b45309',
			danger: '#dc2626',
			mapSecondary: '#7f735d'
		}
	},
	plum: {
		id: 'plum',
		label: 'Plum',
		accent: '#b15a7c',
		dark: {
			canvas: '#120d12',
			panel: '#211821',
			panel2: '#342737',
			panel3: '#46354a',
			line: '#392b3b',
			lineStrong: '#5d4860',
			text: '#fbf6fb',
			textSoft: '#dfcce0',
			textMuted: '#ad93b0',
			overlay: 'rgb(18 13 18 / 0.72)',
			rating: '#f6c453',
			success: '#45d483',
			warning: '#f59e0b',
			danger: '#fb7185',
			mapSecondary: '#7d6d84'
		},
		light: {
			canvas: '#faf7f9',
			panel: '#ffffff',
			panel2: '#f2ecf0',
			panel3: '#e6dbe3',
			line: '#e2d4dd',
			lineStrong: '#c7b3c1',
			text: '#22151f',
			textSoft: '#4b3345',
			textMuted: '#776374',
			overlay: 'rgb(34 21 31 / 0.36)',
			rating: '#a16207',
			success: '#047857',
			warning: '#b45309',
			danger: '#dc2626',
			mapSecondary: '#7e707a'
		}
	},
	tide: {
		id: 'tide',
		label: 'Tide',
		accent: '#2f9aa7',
		dark: {
			canvas: '#061014',
			panel: '#0d1d23',
			panel2: '#19313a',
			panel3: '#26444f',
			line: '#1c3540',
			lineStrong: '#315764',
			text: '#f3fafe',
			textSoft: '#c8dbe2',
			textMuted: '#8ba9b3',
			overlay: 'rgb(6 16 20 / 0.72)',
			rating: '#facc15',
			success: '#45d483',
			warning: '#f59e0b',
			danger: '#fb7185',
			mapSecondary: '#607d88'
		},
		light: {
			canvas: '#f5f9fa',
			panel: '#ffffff',
			panel2: '#eaf2f4',
			panel3: '#dae8eb',
			line: '#d4e2e6',
			lineStrong: '#adc4ca',
			text: '#102026',
			textSoft: '#2d4650',
			textMuted: '#61777f',
			overlay: 'rgb(16 32 38 / 0.36)',
			rating: '#a16207',
			success: '#047857',
			warning: '#b45309',
			danger: '#dc2626',
			mapSecondary: '#667d84'
		}
	}
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function coerceThemeMode(value: unknown): ThemeMode {
	return THEME_MODES.includes(value as ThemeMode) ? (value as ThemeMode) : 'system';
}

export function coerceThemePreset(value: unknown): ThemePresetId {
	return THEME_PRESET_IDS.includes(value as ThemePresetId) ? (value as ThemePresetId) : 'ember';
}

export function normalizeHexAccent(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return HEX_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function resolveBrightness(mode: ThemeMode, prefersDark: boolean): ThemeBrightness {
	if (mode === 'light') return 'light';
	if (mode === 'dark') return 'dark';
	return prefersDark ? 'dark' : 'light';
}

export function themePreferencesFromPartial(value: Partial<ThemePreferences>): ThemePreferences {
	return {
		theme_mode: coerceThemeMode(value.theme_mode),
		theme_preset: coerceThemePreset(value.theme_preset),
		theme_accent: normalizeHexAccent(value.theme_accent)
	};
}

export function buildThemeColors(
	preferences: Partial<ThemePreferences>,
	brightness: ThemeBrightness
): ThemeColors {
	const prefs = themePreferencesFromPartial({
		...DEFAULT_THEME_PREFERENCES,
		...preferences
	});
	const preset = THEME_PRESETS[prefs.theme_preset];
	const neutral = preset[brightness];
	const accent = prefs.theme_accent ?? preset.accent;
	return {
		...neutral,
		...buildAccentPalette(accent, brightness, neutral)
	};
}

export function buildThemeCssVariables(colors: ThemeColors): Record<string, string> {
	return {
		'--theme-canvas': colors.canvas,
		'--theme-panel': colors.panel,
		'--theme-panel-2': colors.panel2,
		'--theme-panel-3': colors.panel3,
		'--theme-line': colors.line,
		'--theme-line-strong': colors.lineStrong,
		'--theme-text': colors.text,
		'--theme-text-soft': colors.textSoft,
		'--theme-text-muted': colors.textMuted,
		'--theme-overlay': colors.overlay,
		'--theme-accent': colors.accent,
		'--theme-accent-soft': colors.accentSoft,
		'--theme-accent-strong': colors.accentStrong,
		'--theme-accent-ring': colors.accentRing,
		'--theme-on-accent': colors.onAccent,
		'--theme-rating': colors.rating,
		'--theme-success': colors.success,
		'--theme-warning': colors.warning,
		'--theme-danger': colors.danger,
		'--theme-map-secondary': colors.mapSecondary
	};
}

export function buildManifestHref(
	preferences: Partial<ThemePreferences>,
	brightness?: ThemeBrightness
): string {
	const prefs = themePreferencesFromPartial({
		...DEFAULT_THEME_PREFERENCES,
		...preferences
	});
	const params = new URLSearchParams({
		preset: prefs.theme_preset,
		mode: prefs.theme_mode
	});
	if (prefs.theme_accent) params.set('accent', prefs.theme_accent);
	if (brightness) params.set('brightness', brightness);
	return `/manifest.webmanifest?${params.toString()}`;
}

function buildAccentPalette(
	accent: string,
	brightness: ThemeBrightness,
	neutral: NeutralTokens
): Pick<ThemeColors, 'accent' | 'accentSoft' | 'accentStrong' | 'accentRing' | 'onAccent'> {
	const accentStrong =
		brightness === 'dark' ? mixHex('#ffffff', accent, 0.12) : mixHex('#000000', accent, 0.16);
	return {
		accent,
		accentSoft: mixHex(
			accent,
			brightness === 'dark' ? neutral.panel : neutral.panel2,
			brightness === 'dark' ? 0.22 : 0.12
		),
		accentStrong,
		accentRing: mixHex(accent, neutral.canvas, brightness === 'dark' ? 0.72 : 0.62),
		onAccent: pickReadableText(accent)
	};
}

function pickReadableText(background: string): '#000000' | '#ffffff' {
	const blackContrast = contrastRatio('#000000', background);
	const whiteContrast = contrastRatio('#ffffff', background);
	return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
}

function contrastRatio(a: string, b: string): number {
	const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
	const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
	return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map((channel) => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mixHex(foreground: string, background: string, amount: number): string {
	const fg = hexToRgb(foreground);
	const bg = hexToRgb(background);
	const p = Math.min(1, Math.max(0, amount));
	return rgbToHex(
		Math.round(fg[0] * p + bg[0] * (1 - p)),
		Math.round(fg[1] * p + bg[1] * (1 - p)),
		Math.round(fg[2] * p + bg[2] * (1 - p))
	);
}

function hexToRgb(hex: string): [number, number, number] {
	const normalized = normalizeHexAccent(hex);
	if (!normalized) throw new Error(`Invalid hex colour: ${hex}`);
	return [
		parseInt(normalized.slice(1, 3), 16),
		parseInt(normalized.slice(3, 5), 16),
		parseInt(normalized.slice(5, 7), 16)
	];
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value: number): string {
	return Math.min(255, Math.max(0, value)).toString(16).padStart(2, '0');
}

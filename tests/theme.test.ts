import { describe, expect, it } from 'vitest';
import {
	buildThemeColors,
	normalizeHexAccent,
	resolveBrightness,
	themePreferencesFromPartial
} from '../src/lib/theme';

describe('theme helpers', () => {
	it('normalizes only full hex accent colours', () => {
		expect(normalizeHexAccent('#ABCDEF')).toBe('#abcdef');
		expect(normalizeHexAccent(' #123456 ')).toBe('#123456');
		expect(normalizeHexAccent('#abc')).toBeNull();
		expect(normalizeHexAccent('tomato')).toBeNull();
		expect(normalizeHexAccent(null)).toBeNull();
	});

	it('coerces invalid theme preferences to defaults', () => {
		expect(
			themePreferencesFromPartial({
				theme_mode: 'midnight' as never,
				theme_preset: 'neon' as never,
				theme_accent: '#abc'
			})
		).toEqual({
			theme_mode: 'system',
			theme_preset: 'ember',
			theme_accent: null
		});
	});

	it('resolves system brightness from the OS preference', () => {
		expect(resolveBrightness('system', true)).toBe('dark');
		expect(resolveBrightness('system', false)).toBe('light');
		expect(resolveBrightness('dark', false)).toBe('dark');
		expect(resolveBrightness('light', true)).toBe('light');
	});

	it('generates a readable accent palette', () => {
		const lightAccent = buildThemeColors(
			{ theme_mode: 'light', theme_preset: 'ember', theme_accent: '#ffffff' },
			'light'
		);
		const darkAccent = buildThemeColors(
			{ theme_mode: 'dark', theme_preset: 'ember', theme_accent: '#000000' },
			'dark'
		);

		expect(lightAccent.accent).toBe('#ffffff');
		expect(lightAccent.onAccent).toBe('#000000');
		expect(lightAccent.accentSoft).not.toBe(lightAccent.accent);
		expect(darkAccent.accent).toBe('#000000');
		expect(darkAccent.onAccent).toBe('#ffffff');
		expect(darkAccent.accentStrong).not.toBe(darkAccent.accent);
	});
});

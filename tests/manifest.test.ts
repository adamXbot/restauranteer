import { describe, expect, it } from 'vitest';
import {
	buildWebManifest,
	manifestBrightnessFromSearchParams,
	themePreferencesFromSearchParams
} from '../src/lib/manifest';

describe('web manifest theming', () => {
	it('uses preset light colours when brightness is explicit', () => {
		const params = new URLSearchParams('preset=basil&mode=light&brightness=light');
		const prefs = themePreferencesFromSearchParams(params);
		const manifest = buildWebManifest(prefs, manifestBrightnessFromSearchParams(params, prefs));

		expect(manifest.theme_color).toBe('#f7faf4');
		expect(manifest.background_color).toBe('#f7faf4');
		expect(manifest.share_target.action).toBe('/inbox');
	});

	it('uses custom accent without changing manifest background', () => {
		const params = new URLSearchParams('preset=tide&mode=dark&accent=%23ff00aa&brightness=dark');
		const prefs = themePreferencesFromSearchParams(params);
		const manifest = buildWebManifest(prefs, manifestBrightnessFromSearchParams(params, prefs));

		expect(prefs.theme_accent).toBe('#ff00aa');
		expect(manifest.theme_color).toBe('#061014');
		expect(manifest.background_color).toBe('#061014');
	});

	it('falls back to dark for system manifests without a runtime brightness query', () => {
		const params = new URLSearchParams('preset=ember&mode=system');
		const prefs = themePreferencesFromSearchParams(params);
		const manifest = buildWebManifest(prefs, manifestBrightnessFromSearchParams(params, prefs));

		expect(manifest.theme_color).toBe('#020617');
	});
});

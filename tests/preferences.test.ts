import { describe, expect, it } from 'vitest';
import { parsePreferences } from '../src/lib/server/preferences';

describe('preferences parsing', () => {
	it('loads legacy preferences with theme defaults', () => {
		const prefs = parsePreferences(
			JSON.stringify({
				per_area_ratings: true,
				default_navigation_app: 'google',
				default_map_provider: 'apple',
				share_format: 'notes_only',
				australian_centric: false,
				show_review_summary: false
			})
		);

		expect(prefs).toMatchObject({
			per_area_ratings: true,
			default_navigation_app: 'google',
			default_map_provider: 'apple',
			share_format: 'notes_only',
			australian_centric: false,
			show_review_summary: false,
			theme_mode: 'system',
			theme_preset: 'ember',
			theme_accent: null
		});
	});

	it('coerces invalid theme values safely', () => {
		const prefs = parsePreferences(
			JSON.stringify({
				theme_mode: 'always',
				theme_preset: 'laser',
				theme_accent: 'hotpink'
			})
		);

		expect(prefs.theme_mode).toBe('system');
		expect(prefs.theme_preset).toBe('ember');
		expect(prefs.theme_accent).toBeNull();
	});
});

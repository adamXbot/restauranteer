#!/usr/bin/env node
/**
 * Regenerate iOS splash screens from the 512x512 PWA icon.
 * Run with: node scripts/gen-splash.mjs
 */
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ICON = path.join(ROOT, 'static', 'icons', 'icon-512.png');
const OUT_DIR = path.join(ROOT, 'static', 'splash');

// Splash background — matches the default Ember dark canvas
// (`THEME_PRESETS.ember.dark.canvas` in src/lib/theme.ts). Splash is static at
// build time so it can't follow the user's chosen preset; this is the safe
// default that won't flash against any reasonable subsequent render.
const BG = { r: 2, g: 6, b: 23, alpha: 1 };

// Apple device PNG dimensions (portrait). Names must match the
// rel="apple-touch-startup-image" entries in src/app.html.
const DEVICES = [
	{ name: 'iphone-se-3-2x.png', w: 750, h: 1334 },
	{ name: 'iphone-13-mini-3x.png', w: 1125, h: 2436 },
	{ name: 'iphone-14-3x.png', w: 1170, h: 2532 },
	{ name: 'iphone-14-pro-3x.png', w: 1179, h: 2556 },
	{ name: 'iphone-14-plus-3x.png', w: 1284, h: 2778 },
	{ name: 'iphone-14-pro-max-3x.png', w: 1290, h: 2796 },
	{ name: 'ipad-pro-11-2x.png', w: 1668, h: 2388 }
];

const ICON_FRACTION = 0.32; // ~32% of shorter dimension

const sourceIcon = await readFile(SOURCE_ICON);

for (const d of DEVICES) {
	const iconSize = Math.round(Math.min(d.w, d.h) * ICON_FRACTION);
	const iconBuffer = await sharp(sourceIcon)
		.resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();

	const out = path.join(OUT_DIR, d.name);
	await sharp({
		create: { width: d.w, height: d.h, channels: 4, background: BG }
	})
		.composite([{ input: iconBuffer, gravity: 'center' }])
		.png({ compressionLevel: 9 })
		.toFile(out);

	console.log(`✓ ${d.name} (${d.w}×${d.h}, icon ${iconSize}px)`);
}

#!/usr/bin/env node
/**
 * Regenerate the maskable + Apple touch PWA icons from static/favicon.svg.
 * Run with: node scripts/gen-icons.mjs
 *
 * Maskable and apple-touch icons must be FULL-BLEED (fill the whole square, no
 * transparent corners) with the logo inside the safe zone, because the OS
 * applies its own mask/rounding. The "any"-purpose icons (icon-192/512.png)
 * keep their rounded-tile look and are left untouched.
 */
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAVICON = path.join(ROOT, 'static', 'favicon.svg');
const ICONS = path.join(ROOT, 'static', 'icons');

// Brand tile colour (matches the favicon background gradient's light end).
const CREAM = { r: 0xfc, g: 0xf8, b: 0xf1, alpha: 1 };

const svg = await readFile(FAVICON, 'utf8');
// Strip the cream background rects + drop-shadow filter → logo marks only, on a
// transparent canvas, so we can trim and re-centre them precisely.
const logoSvg = svg
	.replace(/<rect[^>]*\/>/g, '')
	.replace(/\s+filter="url\(#shapeShadow\)"/g, '');

const logoHiRes = await sharp(Buffer.from(logoSvg))
	.resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
	.png()
	.toBuffer();
// Trim the transparent margin so `fraction` is measured against the real mark.
const logo = await sharp(logoHiRes).trim().png().toBuffer();

async function fullBleed(size, fraction, outfile) {
	const target = Math.round(size * fraction);
	const mark = await sharp(logo)
		.resize(target, target, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toBuffer();
	await sharp({ create: { width: size, height: size, channels: 4, background: CREAM } })
		.composite([{ input: mark, gravity: 'center' }])
		.png({ compressionLevel: 9 })
		.toFile(outfile);
	console.log(`✓ ${path.basename(outfile)} (${size}px, logo ~${Math.round(fraction * 100)}%)`);
}

// Maskable: logo within the ~66% safe zone (survives circle/squircle masks).
await fullBleed(512, 0.66, path.join(ICONS, 'icon-maskable-512.png'));
await fullBleed(192, 0.66, path.join(ICONS, 'icon-maskable-192.png'));
// Apple touch: iOS rounds gently, so the mark can sit a little larger.
await fullBleed(180, 0.72, path.join(ICONS, 'apple-touch-icon.png'));

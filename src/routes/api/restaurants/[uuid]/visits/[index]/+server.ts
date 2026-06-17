import { error, json } from '@sveltejs/kit';
import path from 'node:path';
import { mkdir, unlink } from 'node:fs/promises';
import type { RequestHandler } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import { saveRestaurant } from '$lib/server/vault/save';
import { processUploadedImage } from '$lib/server/images';
import { atomicWriteBinary } from '$lib/server/vault/writer';
import {
	coerceDishMeta,
	extractImagePaths,
	parseVisits,
	removeVisitFromBody,
	slugFromFilePath,
	splitBodyAtVisits,
	updateVisitInBody,
	type Dish,
	type VisitInput
} from '$lib/server/vault/visit';
import { attachmentsDir } from '$lib/server/config';
import { log } from '$lib/server/log';
import { slugifyLabel, type AttributeValue } from '$lib/attributes';

function readAttributeOverrides(form: FormData): Record<string, AttributeValue> {
	const out: Record<string, AttributeValue> = {};
	for (const key of form.keys()) {
		if (!key.startsWith('attribute_')) continue;
		const id = slugifyLabel(key.slice('attribute_'.length));
		if (!id) continue;
		const raw = form.get(key);
		if (typeof raw !== 'string') continue;
		const v = raw.trim().toLowerCase();
		if (v === 'yes') out[id] = 'yes';
		else if (v === 'no') out[id] = 'no';
	}
	return out;
}

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_PHOTOS_PER_VISIT = 8;
const MAX_RATING = 5;

function readField(form: FormData, name: string): string | null {
	const v = form.get(name);
	return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function readNumberField(form: FormData, name: string): number | null {
	const v = form.get(name);
	if (typeof v !== 'string' || v.trim().length === 0) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function timestampStamp(): string {
	const d = new Date();
	const pad = (n: number) => n.toString().padStart(2, '0');
	return (
		`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
		`-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
	);
}

function parseIndex(raw: string): number {
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) throw error(400, 'invalid visit index');
	return n;
}

/**
 * Best-effort deletion of a photo path. Only removes files inside the
 * attachments dir and silently skips on failure (file may be gone, locked
 * by another process, etc.). Also removes the `.thumb.jpg` sibling if present.
 */
async function deletePhotoFile(photoPath: string): Promise<void> {
	if (!photoPath.startsWith('_attachments/')) return;
	const rel = photoPath.slice('_attachments/'.length);
	const root = path.resolve(attachmentsDir());
	const abs = path.resolve(attachmentsDir(), rel);
	if (!abs.startsWith(root + path.sep)) return;
	const thumb = abs.replace(/\.([a-zA-Z0-9]+)$/, '.thumb.$1');
	for (const candidate of [abs, thumb]) {
		try {
			await unlink(candidate);
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code !== 'ENOENT') log.warn('Photo delete failed', { path: candidate, code });
		}
	}
}

export const PUT: RequestHandler = async ({ params, request }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');
	const idx = parseIndex(params.index);

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		throw error(400, 'invalid form data');
	}

	const rf = await readRestaurant(indexed.file_path);
	const split = splitBodyAtVisits(rf.body);
	const existingVisits = parseVisits(split.visitsSection);
	const existing = existingVisits[idx];
	if (!existing) throw error(404, 'Visit not found');

	const date = readField(form, 'date') ?? existing.date;
	const meal = readField(form, 'meal');
	const companions = readField(form, 'companions');
	const vibe = readField(form, 'vibe');
	const food = readField(form, 'food');
	const quality = readField(form, 'quality');
	const service = readField(form, 'service');
	const notes = readField(form, 'notes');
	const rating = readNumberField(form, 'rating');
	if (rating != null && (rating < 0 || rating > MAX_RATING))
		throw error(400, 'rating out of range');
	const areaRatings = {
		vibe: readNumberField(form, 'vibe_rating'),
		food: readNumberField(form, 'food_rating'),
		quality: readNumberField(form, 'quality_rating'),
		service: readNumberField(form, 'service_rating')
	};
	for (const [k, v] of Object.entries(areaRatings)) {
		if (v != null && (v < 0 || v > MAX_RATING)) throw error(400, `${k}_rating out of range`);
	}

	const keepPhotos = form
		.getAll('keep_photo')
		.filter((v): v is string => typeof v === 'string' && v.startsWith('_attachments/'));
	// Only honour keep_photo values that actually belong to this visit.
	const keptSet = new Set(existing.photoPaths.filter((p) => keepPhotos.includes(p)));

	const newPhotos = form.getAll('photo').filter((v): v is File => v instanceof File && v.size > 0);
	if (keptSet.size + newPhotos.length > MAX_PHOTOS_PER_VISIT) {
		throw error(400, `too many photos (max ${MAX_PHOTOS_PER_VISIT})`);
	}

	const dishMeta = coerceDishMeta(form.get('dishes'));
	const dishFiles = dishMeta.map((_, i) => {
		const f = form.get(`dish_photo_${i}`);
		return f instanceof File && f.size > 0 ? f : null;
	});
	const anyDishFile = dishFiles.some((f) => f !== null);

	const slug = slugFromFilePath(indexed.file_path);
	const slugDir = path.join(attachmentsDir(), slug);
	if (newPhotos.length > 0 || anyDishFile) await mkdir(slugDir, { recursive: true });
	const stamp = timestampStamp();
	const newPaths: string[] = [];

	for (let i = 0; i < newPhotos.length; i++) {
		const photo = newPhotos[i];
		if (photo.size > MAX_PHOTO_BYTES) {
			throw error(413, `photo ${i + 1} exceeds ${MAX_PHOTO_BYTES} bytes`);
		}
		const buf = Buffer.from(await photo.arrayBuffer());
		let processed;
		try {
			processed = await processUploadedImage(buf);
		} catch (e) {
			log.error('Image processing failed', { error: String(e), index: i });
			throw error(400, `photo ${i + 1} could not be processed`);
		}
		const baseName = `${stamp}-e${i + 1}`;
		const mainPath = path.join(slugDir, `${baseName}.jpg`);
		const thumbPath = path.join(slugDir, `${baseName}.thumb.jpg`);
		await atomicWriteBinary(mainPath, processed.main);
		await atomicWriteBinary(thumbPath, processed.thumb);
		newPaths.push(`_attachments/${slug}/${baseName}.jpg`);
	}

	const imagePaths = [...existing.photoPaths.filter((p) => keptSet.has(p)), ...newPaths];

	// Dishes (Food breakdown). Resolve each dish's photo: a freshly-uploaded
	// `dish_photo_<i>` wins, else a `keepPhoto` that belongs to this visit, else
	// none. Replaced/removed dish photos are cleaned up by the diff below.
	const existingPhotoSet = new Set(existing.photoPaths);
	const dishes: Dish[] = [];
	for (let i = 0; i < dishMeta.length; i++) {
		const meta = dishMeta[i];
		const file = dishFiles[i];
		let photoPath: string | null = null;
		if (file) {
			if (file.size > MAX_PHOTO_BYTES) {
				throw error(413, `dish photo ${i + 1} exceeds ${MAX_PHOTO_BYTES} bytes`);
			}
			const buf = Buffer.from(await file.arrayBuffer());
			let processed;
			try {
				processed = await processUploadedImage(buf);
			} catch (e) {
				log.error('Dish image processing failed', { error: String(e), index: i });
				throw error(400, `dish photo ${i + 1} could not be processed`);
			}
			const baseName = `${stamp}-de${i + 1}`;
			await atomicWriteBinary(path.join(slugDir, `${baseName}.jpg`), processed.main);
			await atomicWriteBinary(path.join(slugDir, `${baseName}.thumb.jpg`), processed.thumb);
			photoPath = `_attachments/${slug}/${baseName}.jpg`;
		} else if (meta.keepPhoto && existingPhotoSet.has(meta.keepPhoto)) {
			photoPath = meta.keepPhoto;
		}
		dishes.push({ name: meta.name, rating: meta.rating, note: meta.note, photoPath });
	}

	const attributeOverrides = readAttributeOverrides(form);
	const visit: VisitInput = {
		date,
		meal,
		companions,
		vibe,
		food,
		quality,
		service,
		rating,
		areaRatings,
		notes,
		imagePaths,
		attributeOverrides: Object.keys(attributeOverrides).length > 0 ? attributeOverrides : null,
		dishes: dishes.length > 0 ? dishes : null
	};

	const newBody = updateVisitInBody(rf.body, idx, visit);
	await saveRestaurant(indexed.file_path, rf.frontmatter, newBody);

	// Best-effort delete of removed photos — but only if no other part of the
	// file still references them (defensive against the rare case of the same
	// path appearing in multiple visits).
	const stillReferenced = new Set(extractImagePaths(newBody));
	const toDelete = existing.photoPaths.filter(
		(p) => !keptSet.has(p) && !stillReferenced.has(p)
	);
	for (const p of toDelete) await deletePhotoFile(p);

	return json({ ok: true, removed_photos: toDelete.length, new_photos: newPaths.length });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');
	const idx = parseIndex(params.index);

	const rf = await readRestaurant(indexed.file_path);
	const split = splitBodyAtVisits(rf.body);
	const existingVisits = parseVisits(split.visitsSection);
	const existing = existingVisits[idx];
	if (!existing) throw error(404, 'Visit not found');

	const newBody = removeVisitFromBody(rf.body, idx);
	await saveRestaurant(indexed.file_path, rf.frontmatter, newBody);

	const stillReferenced = new Set(extractImagePaths(newBody));
	const toDelete = existing.photoPaths.filter((p) => !stillReferenced.has(p));
	for (const p of toDelete) await deletePhotoFile(p);

	return json({ ok: true, removed_photos: toDelete.length });
};

import { error, json } from '@sveltejs/kit';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { RequestHandler } from './$types';
import { getRestaurantByUuid } from '$lib/server/db/queries';
import { readRestaurant } from '$lib/server/vault/reader';
import { saveRestaurant } from '$lib/server/vault/save';
import { processUploadedImage } from '$lib/server/images';
import { atomicWriteBinary } from '$lib/server/vault/writer';
import { appendVisitToBody, slugFromFilePath, type VisitInput } from '$lib/server/vault/visit';
import { attachmentsDir } from '$lib/server/config';
import { log } from '$lib/server/log';

const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // 20MB raw upload before we resize
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

export const POST: RequestHandler = async ({ params, request }) => {
	const indexed = getRestaurantByUuid(params.uuid);
	if (!indexed) throw error(404, 'Restaurant not found');

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		throw error(400, 'invalid form data');
	}

	const date = readField(form, 'date') ?? new Date().toISOString().slice(0, 10);
	const meal = readField(form, 'meal');
	const companions = readField(form, 'companions');
	const vibe = readField(form, 'vibe');
	const food = readField(form, 'food');
	const quality = readField(form, 'quality');
	const service = readField(form, 'service');
	const notes = readField(form, 'notes');
	const rating = readNumberField(form, 'rating');
	if (rating != null && (rating < 0 || rating > MAX_RATING)) throw error(400, 'rating out of range');
	const areaRatings = {
		vibe: readNumberField(form, 'vibe_rating'),
		food: readNumberField(form, 'food_rating'),
		quality: readNumberField(form, 'quality_rating'),
		service: readNumberField(form, 'service_rating')
	};
	for (const [k, v] of Object.entries(areaRatings)) {
		if (v != null && (v < 0 || v > MAX_RATING)) throw error(400, `${k}_rating out of range`);
	}

	const photos = form.getAll('photo').filter((v): v is File => v instanceof File && v.size > 0);
	if (photos.length > MAX_PHOTOS_PER_VISIT) {
		throw error(400, `too many photos (max ${MAX_PHOTOS_PER_VISIT})`);
	}

	const slug = slugFromFilePath(indexed.file_path);
	const slugDir = path.join(attachmentsDir(), slug);
	await mkdir(slugDir, { recursive: true });
	const stamp = timestampStamp();
	const savedPaths: string[] = [];

	for (let i = 0; i < photos.length; i++) {
		const photo = photos[i];
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
		const baseName = `${stamp}-${i + 1}`;
		const mainPath = path.join(slugDir, `${baseName}.jpg`);
		const thumbPath = path.join(slugDir, `${baseName}.thumb.jpg`);
		await atomicWriteBinary(mainPath, processed.main);
		await atomicWriteBinary(thumbPath, processed.thumb);
		savedPaths.push(`_attachments/${slug}/${baseName}.jpg`);
	}

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
		imagePaths: savedPaths
	};

	const rf = await readRestaurant(indexed.file_path);
	const newBody = appendVisitToBody(rf.body, visit);
	await saveRestaurant(indexed.file_path, rf.frontmatter, newBody);

	return json(
		{
			date,
			photo_count: savedPaths.length,
			photo_paths: savedPaths
		},
		{ status: 201 }
	);
};

import sharp from 'sharp';

const MAX_WIDTH = 1600;
const QUALITY = 85;
const THUMB_WIDTH = 320;

export type ProcessedImage = {
	main: Buffer;
	thumb: Buffer;
	width: number;
	height: number;
};

export async function processUploadedImage(input: Buffer): Promise<ProcessedImage> {
	const pipeline = sharp(input, { failOn: 'truncated' }).rotate();
	const meta = await pipeline.metadata();
	const sourceWidth = meta.width ?? MAX_WIDTH;
	const targetWidth = Math.min(sourceWidth, MAX_WIDTH);

	const main = await pipeline
		.clone()
		.resize({ width: targetWidth, withoutEnlargement: true, fit: 'inside' })
		.jpeg({ quality: QUALITY, mozjpeg: true })
		.toBuffer({ resolveWithObject: true });

	const thumb = await pipeline
		.clone()
		.resize({ width: THUMB_WIDTH, withoutEnlargement: true, fit: 'inside' })
		.jpeg({ quality: 78, mozjpeg: true })
		.toBuffer();

	return {
		main: main.data,
		thumb,
		width: main.info.width,
		height: main.info.height
	};
}

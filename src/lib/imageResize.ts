const MAX_WIDTH = 1600;
const QUALITY = 0.85;

export async function resizeForUpload(file: File): Promise<File> {
	if (!file.type.startsWith('image/')) return file;
	const img = new Image();
	const url = URL.createObjectURL(file);
	try {
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('image decode failed'));
			img.src = url;
		});
		if (img.width <= MAX_WIDTH && img.height <= MAX_WIDTH) {
			return file;
		}
		const ratio = Math.min(MAX_WIDTH / img.width, MAX_WIDTH / img.height, 1);
		const w = Math.round(img.width * ratio);
		const h = Math.round(img.height * ratio);

		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) return file;
		ctx.drawImage(img, 0, 0, w, h);

		const blob = await new Promise<Blob | null>((res) => {
			canvas.toBlob((b) => res(b), 'image/jpeg', QUALITY);
		});
		if (!blob) return file;
		const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
		return new File([blob], newName, { type: 'image/jpeg' });
	} finally {
		URL.revokeObjectURL(url);
	}
}

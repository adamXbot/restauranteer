/**
 * A visit photo as the Markdown stores it. Two forms:
 *
 *   ![](_attachments/etta/20260509-103015-1.jpg)
 *   ![](immich:4d6f3c1e-8a2b-4c1d-9e0f-123456789abc)
 *
 * The first is a file in the vault. The second is an asset that stays in
 * Immich and is shown through `/api/immich/<id>`, the way a `google:` featured
 * image is shown through `/api/photos` — it carries a scheme rather than
 * pretending to be a path.
 */

const ATTACHMENTS = '_attachments/';
const IMMICH_RE =
	/^immich:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The Immich asset id of an `immich:` ref, or null for anything else. */
export function immichAssetId(ref: string): string | null {
	return ref.match(IMMICH_RE)?.[1]?.toLowerCase() ?? null;
}

export function isVisitPhoto(ref: string): boolean {
	return ref.startsWith(ATTACHMENTS) || immichAssetId(ref) !== null;
}

/** URL of the full-size photo. */
export function photoUrl(ref: string): string {
	const id = immichAssetId(ref);
	if (id) return `/api/immich/${id}?size=preview`;
	return `/api/attachments/${encodeURI(ref.replace(/^_attachments\//, ''))}`;
}

/** URL of the small square-ish photo lists and grids draw. */
export function photoThumbUrl(ref: string): string {
	const id = immichAssetId(ref);
	if (id) return `/api/immich/${id}?size=thumbnail`;
	const stem = ref.replace(/\.(jpg|jpeg|png|webp)$/i, '');
	return photoUrl(`${stem}.thumb.jpg`);
}

import type { VisitSummary } from '$lib/server/vault/visit';

/**
 * The picture that represents a restaurant.
 *
 * Read from the `featured_image` frontmatter key, which the iOS companion
 * app writes and this app now honours. Two forms:
 *
 *   featured_image: _attachments/etta/20260509-103015-1.jpg
 *   featured_image: 'google:places/ChIJ…/photos/ABC'
 *
 * The first is a vault attachment, written exactly the way visit photo
 * paths already appear in the Markdown body — so it resolves through the
 * same `/attachments/…` route as every other photo, and Obsidian renders it.
 * The second is a Google photo resource name, which needs a Places key to
 * display and therefore carries a scheme rather than pretending to be a path.
 *
 * **Absent means "derive one"** — the newest visit's first photo, which is
 * what this app did before the key existed. A vault that has never seen the
 * key behaves exactly as it always has.
 */

const GOOGLE_SCHEME = 'google:';

export type FeaturedImage =
	| { kind: 'attachment'; path: string }
	| { kind: 'google'; photoName: string };

/**
 * Parse a stored `featured_image` value. Anything unrecognised is treated as
 * absent rather than guessed at: a wrong cover is worse than a derived one.
 */
export function parseFeaturedImage(stored: unknown): FeaturedImage | null {
	if (typeof stored !== 'string') return null;
	const raw = stored.trim();
	if (raw === '') return null;

	if (raw.startsWith(GOOGLE_SCHEME)) {
		const photoName = raw.slice(GOOGLE_SCHEME.length);
		return photoName === '' ? null : { kind: 'google', photoName };
	}

	// This value becomes a URL path. A vault is not the place to honour '..',
	// and a bare filename is not an attachments path.
	if (raw.startsWith('/') || raw.includes('..') || !raw.includes('/')) return null;
	return { kind: 'attachment', path: raw };
}

/**
 * The attachment path to show for a restaurant card, or null for none.
 *
 * A Google pick falls back to the derived photo here on purpose: the card
 * renders from the vault's own files, and a list that needs a Places request
 * to draw a row is worse than one showing the photo the user took. The
 * restaurant page can still lead with the Google shot.
 */
export function coverPhotoPath(
	frontmatter: Record<string, unknown>,
	visitSummary: VisitSummary | null | undefined
): string | null {
	const chosen = parseFeaturedImage(frontmatter.featured_image);
	if (chosen?.kind === 'attachment') return chosen.path;
	return visitSummary?.latest?.photo ?? null;
}

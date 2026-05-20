export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Share or copy a block of text (not a URL). Falls back to the clipboard if
 * `navigator.share` isn't available, and then to the legacy execCommand trick
 * for insecure contexts (HTTP LAN access without HTTPS).
 */
export async function shareOrCopyText(text: string, title?: string): Promise<ShareOutcome> {
	if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
		try {
			await navigator.share({ text, title });
			return 'shared';
		} catch (e) {
			const err = e as DOMException;
			if (err?.name === 'AbortError') return 'cancelled';
			// other errors fall through to clipboard
		}
	}
	if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return 'copied';
		} catch {
			// fall through
		}
	}
	try {
		if (typeof document === 'undefined') return 'failed';
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		document.body.removeChild(ta);
		return ok ? 'copied' : 'failed';
	} catch {
		return 'failed';
	}
}

/**
 * Share a URL via the platform's native share sheet (iOS Safari, Android
 * Chrome) and fall back to clipboard if that's not available. Falls back
 * further to the legacy execCommand trick for insecure-context cases (HTTP
 * LAN access without HTTPS).
 */
export async function shareOrCopy(url: string, title?: string): Promise<ShareOutcome> {
	if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
		try {
			await navigator.share({ url, title: title ?? url });
			return 'shared';
		} catch (e) {
			const err = e as DOMException;
			// User dismissed the share sheet — not a failure
			if (err?.name === 'AbortError') return 'cancelled';
			// other errors fall through to clipboard
		}
	}
	if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(url);
			return 'copied';
		} catch {
			// fall through
		}
	}
	// Legacy fallback for insecure contexts
	try {
		if (typeof document === 'undefined') return 'failed';
		const ta = document.createElement('textarea');
		ta.value = url;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		document.body.removeChild(ta);
		return ok ? 'copied' : 'failed';
	} catch {
		return 'failed';
	}
}

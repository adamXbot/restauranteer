<script lang="ts">
	type Visit = {
		id: string;
		date: string;
		meal: string | null;
		headline: string;
		photoPaths: string[];
		shareText: {
			full: string;
			notes_only: string;
		};
	};

	type Props = {
		visit: Visit;
		restaurantName: string;
		shareFormat: 'full' | 'notes_only';
		googlePlaceId: string | null;
		onClose: () => void;
	};

	let { visit, restaurantName, shareFormat, googlePlaceId, onClose }: Props = $props();

	let attachPhotos = $state(true);
	let busy = $state<string | null>(null);
	let toast = $state<string | null>(null);
	let canShareFiles = $state(false);

	const text = $derived(visit.shareText[shareFormat] ?? visit.shareText.full);
	const photoCount = $derived(visit.photoPaths.length);
	const writeReviewUrl = $derived(
		googlePlaceId
			? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(googlePlaceId)}`
			: null
	);

	$effect(() => {
		try {
			canShareFiles =
				typeof navigator !== 'undefined' &&
				typeof navigator.canShare === 'function' &&
				navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
		} catch {
			canShareFiles = false;
		}
	});

	function flashToast(msg: string) {
		toast = msg;
		setTimeout(() => {
			if (toast === msg) toast = null;
		}, 2200);
	}

	async function copyText(): Promise<boolean> {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
				return true;
			}
		} catch {
			/* fall through */
		}
		try {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand('copy');
			document.body.removeChild(ta);
			return ok;
		} catch {
			return false;
		}
	}

	async function loadPhotoFiles(): Promise<File[]> {
		const files: File[] = [];
		for (const p of visit.photoPaths) {
			try {
				const rel = p.replace(/^_attachments\//, '');
				const res = await fetch(`/api/attachments/${encodeURI(rel)}`);
				if (!res.ok) continue;
				const blob = await res.blob();
				const name = p.split('/').pop() ?? 'photo.jpg';
				files.push(new File([blob], name, { type: blob.type || 'image/jpeg' }));
			} catch {
				/* skip individual failures */
			}
		}
		return files;
	}

	async function openGoogleMaps() {
		if (!writeReviewUrl) return;
		busy = 'google';
		try {
			const copied = await copyText();
			flashToast(copied ? 'Review copied — paste in Google Maps' : 'Open Google Maps and write your review');
			window.open(writeReviewUrl, '_blank', 'noopener');
		} finally {
			busy = null;
		}
	}

	async function shareViaApps() {
		busy = 'os';
		try {
			const payload: ShareData = {
				title: `${restaurantName} — ${visit.headline}`,
				text
			};
			if (attachPhotos && photoCount > 0 && canShareFiles) {
				const files = await loadPhotoFiles();
				if (files.length > 0) (payload as ShareData & { files: File[] }).files = files;
			}
			if (typeof navigator.share === 'function') {
				await navigator.share(payload);
				flashToast('Shared');
			} else {
				const copied = await copyText();
				flashToast(copied ? 'Copied to clipboard' : 'Could not share');
			}
		} catch (e) {
			const err = e as DOMException;
			if (err?.name !== 'AbortError') flashToast(`Share failed: ${err?.message ?? err}`);
		} finally {
			busy = null;
		}
	}

	async function savePhotos() {
		if (photoCount === 0) return;
		busy = 'photos';
		try {
			const files = await loadPhotoFiles();
			if (files.length === 0) {
				flashToast('No photos available');
				return;
			}
			if (typeof navigator.share === 'function' && canShareFiles) {
				await navigator.share({
					title: `${restaurantName} — ${visit.headline} photos`,
					files
				});
				flashToast('Pick "Save to Photos" in the share sheet');
			} else {
				flashToast("Your browser can't share files — long-press a thumbnail to save");
			}
		} catch (e) {
			const err = e as DOMException;
			if (err?.name !== 'AbortError') flashToast(`Save failed: ${err?.message ?? err}`);
		} finally {
			busy = null;
		}
	}
</script>

<div
	class="fixed inset-0 z-40 flex flex-col justify-end bg-slate-950/70"
	role="dialog"
	aria-modal="true"
>
	<button
		type="button"
		class="absolute inset-0 -z-10 h-full w-full cursor-default"
		aria-label="Close"
		onclick={onClose}
	></button>
	<section class="rounded-t-3xl border-t border-slate-800 bg-slate-900 p-5 pb-8">
		<header class="mb-3 flex items-baseline justify-between gap-2">
			<div>
				<h2 class="text-base font-medium text-slate-100">Share visit</h2>
				<p class="text-xs text-slate-500">{restaurantName} · {visit.headline}</p>
			</div>
			<button type="button" onclick={onClose} class="text-xs text-slate-400">Cancel</button>
		</header>

		<p class="mb-1 text-[10px] tracking-widest text-slate-500 uppercase">
			Preview ({shareFormat === 'full' ? 'full' : 'notes only'})
		</p>
		<pre
			class="max-h-40 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs whitespace-pre-wrap text-slate-300">{text}</pre>
		<p class="mt-1 text-[11px] text-slate-500">
			Change "full / notes only" in <a
				href="/settings"
				class="underline decoration-slate-700 underline-offset-2">Settings</a
			>.
		</p>

		{#if photoCount > 0}
			<label class="mt-4 flex items-center gap-2 text-sm text-slate-200">
				<input
					type="checkbox"
					bind:checked={attachPhotos}
					class="h-4 w-4 rounded border-slate-700 bg-slate-900"
				/>
				Attach photos ({photoCount})
			</label>
			{#if !canShareFiles}
				<p class="mt-1 text-[11px] text-amber-400/80">
					This browser can't attach files to the share sheet — photos can still be saved manually.
				</p>
			{/if}
		{/if}

		{#if toast}
			<p class="mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-200">
				{toast}
			</p>
		{/if}

		<div class="mt-4 grid gap-2">
			{#if writeReviewUrl}
				<button
					type="button"
					onclick={openGoogleMaps}
					disabled={busy !== null}
					class="rounded-2xl bg-orange-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
				>
					{busy === 'google' ? 'Opening…' : 'Open in Google Maps'}
				</button>
			{/if}
			<button
				type="button"
				onclick={shareViaApps}
				disabled={busy !== null}
				class="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 disabled:opacity-50"
			>
				{busy === 'os' ? 'Sharing…' : 'Share via Apps'}
			</button>
			{#if attachPhotos && photoCount > 0}
				<button
					type="button"
					onclick={savePhotos}
					disabled={busy !== null}
					class="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-200 disabled:opacity-50"
				>
					{busy === 'photos' ? 'Opening…' : 'Save photos to library'}
				</button>
			{/if}
		</div>
		{#if !writeReviewUrl}
			<p class="mt-3 text-[11px] text-slate-500">
				Link a Google Maps URL to this restaurant to enable "Open in Google Maps".
			</p>
		{/if}
	</section>
</div>

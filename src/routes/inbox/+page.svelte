<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import BackLink from '$lib/components/BackLink.svelte';
	import MergePicker from '$lib/components/MergePicker.svelte';

	type Suggestion = { uuid: string; name: string; suburb: string | null };
	type InboxItem = {
		id: number;
		url: string;
		source: string;
		title: string;
		excerpt: string | null;
		image_url: string | null;
		suggested_uuid: string | null;
		created_at: number;
		suggestions: Suggestion[];
	};

	type Candidate = {
		uuid: string;
		name: string;
		suburb: string | null;
		address: string | null;
		score: number;
		distance_m: number | null;
		reason: 'exact_name' | 'name_subset' | 'token_overlap';
	};

	type Preview = {
		name: string;
		address: string | null;
		lat: number | null;
		lng: number | null;
	};

	type ImportResponse =
		| { type: 'created' | 'linked'; uuid: string; source: string }
		| { type: 'candidates'; source: string; candidates: Candidate[]; preview: Preview };

	const SOURCE_LABEL: Record<string, string> = {
		broadsheet: 'Broadsheet',
		goodfood: 'Good Food',
		agfg: 'AGFG',
		applemaps: 'Apple Maps',
		timeout: 'Time Out',
		google: 'Google Maps',
		instagram: 'Instagram',
		tiktok: 'TikTok',
		reddit: 'Reddit',
		tripadvisor: 'TripAdvisor',
		youtube: 'YouTube',
		facebook: 'Facebook',
		yelp: 'Yelp'
	};

	function sourceLabel(s: string): string {
		return SOURCE_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
	}

	let { data }: { data: PageData } = $props();

	let urlInput = $state('');
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let lastMsg = $state<string | null>(null);

	// Auto-import dispatch for known adapter URLs (Broadsheet / Good Food /
	// AGFG / Time Out / Apple Maps / Google Maps).
	let detectedSource = $state<{ source: string; label: string } | null>(null);
	let autoImport = $state(true);
	let detectTimer: ReturnType<typeof setTimeout> | null = null;
	let mergeContext = $state<{
		url: string;
		source: string;
		candidates: Candidate[];
		preview: Preview;
	} | null>(null);

	function scheduleDetect(value: string) {
		if (detectTimer) clearTimeout(detectTimer);
		const trimmed = value.trim();
		if (!/^https?:\/\//i.test(trimmed)) {
			detectedSource = null;
			return;
		}
		detectTimer = setTimeout(() => runDetect(trimmed), 200);
	}

	async function runDetect(url: string) {
		try {
			const res = await fetch(`/api/sources/detect?url=${encodeURIComponent(url)}`);
			if (!res.ok) {
				detectedSource = null;
				return;
			}
			const data = (await res.json()) as { source: string | null; label: string | null };
			if (urlInput.trim() !== url) return; // stale
			detectedSource = data.source && data.label ? { source: data.source, label: data.label } : null;
		} catch {
			detectedSource = null;
		}
	}

	type CreateForm = { name: string; suburb: string; address: string; cuisine: string };
	let creatingFor = $state<number | null>(null);
	let createForm = $state<CreateForm>({ name: '', suburb: '', address: '', cuisine: '' });
	let attachingId = $state<number | null>(null);
	let dismissingId = $state<number | null>(null);

	// Pickers — show vault search when no suggestion or user wants to pick manually
	let pickingFor = $state<number | null>(null);
	let pickerQuery = $state('');
	let pickerResults = $state<Suggestion[]>([]);
	let pickerLoading = $state(false);

	async function saveUrl(rawUrl: string, opts: { forceQueue?: boolean } = {}) {
		const url = rawUrl.trim();
		if (!url) return;
		saving = true;
		saveError = null;
		try {
			// Adapter URLs run through /api/import unless the user toggled
			// "Auto-import" off (or we're explicitly forcing the inbox queue,
			// e.g. when handling a Web Share Target intent).
			const eager = !opts.forceQueue && autoImport && detectedSource !== null;
			if (eager) {
				const ok = await runAutoImport(url);
				if (ok) return;
				// Fall through — the user closed the merge picker; the URL was
				// not saved anywhere, mirror that in the UI.
				return;
			}

			const res = await fetch('/api/inbox', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url })
			});
			if (!res.ok) {
				saveError = await res.text();
				return;
			}
			const result = (await res.json()) as
				| { status: 'added'; item: InboxItem }
				| { status: 'already_pending'; item: InboxItem }
				| { status: 'already_attached'; uuid: string };
			if (result.status === 'already_attached') {
				lastMsg = 'This link is already attached to a restaurant.';
				await goto(`/restaurant/${result.uuid}`);
				return;
			}
			lastMsg = result.status === 'already_pending' ? 'Already in your inbox.' : 'Saved.';
			urlInput = '';
			detectedSource = null;
			await invalidateAll();
		} catch (e) {
			saveError = String(e);
		} finally {
			saving = false;
		}
	}

	/**
	 * Dispatches an adapter URL to /api/import. Returns true if the import
	 * resolved (created/linked/candidates picker armed) and the caller should
	 * stop, false on a soft error so the caller can decide whether to fall
	 * back.
	 */
	async function runAutoImport(url: string): Promise<boolean> {
		try {
			const res = await fetch('/api/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url })
			});
			if (!res.ok) {
				saveError = (await res.text()) || `HTTP ${res.status}`;
				return false;
			}
			const result = (await res.json()) as ImportResponse;
			if (result.type === 'candidates') {
				mergeContext = {
					url,
					source: result.source,
					candidates: result.candidates,
					preview: result.preview
				};
				return true;
			}
			urlInput = '';
			detectedSource = null;
			await goto(`/restaurant/${result.uuid}`);
			return true;
		} catch (e) {
			saveError = String(e instanceof Error ? e.message : e);
			return false;
		}
	}

	async function mergeInto(uuid: string) {
		if (!mergeContext) return;
		const ctx = mergeContext;
		try {
			const res = await fetch('/api/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: ctx.url, link_to_uuid: uuid })
			});
			if (!res.ok) {
				saveError = (await res.text()) || `HTTP ${res.status}`;
				return;
			}
			mergeContext = null;
			urlInput = '';
			detectedSource = null;
			await goto(`/restaurant/${uuid}`);
		} catch (e) {
			saveError = String(e instanceof Error ? e.message : e);
		}
	}

	async function createNewFromMerge() {
		if (!mergeContext) return;
		const ctx = mergeContext;
		try {
			const res = await fetch('/api/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: ctx.url, force_new: true })
			});
			if (!res.ok) {
				saveError = (await res.text()) || `HTTP ${res.status}`;
				return;
			}
			const result = (await res.json()) as ImportResponse;
			if (result.type === 'candidates') {
				saveError = 'Unexpected response when creating new';
				return;
			}
			mergeContext = null;
			urlInput = '';
			detectedSource = null;
			await goto(`/restaurant/${result.uuid}`);
		} catch (e) {
			saveError = String(e instanceof Error ? e.message : e);
		}
	}

	async function tryPasteFromClipboard() {
		if (!navigator.clipboard?.readText) return;
		try {
			const text = (await navigator.clipboard.readText()).trim();
			if (/^https?:\/\//i.test(text)) {
				urlInput = text;
				scheduleDetect(text);
			}
		} catch {
			// User denied permission, or clipboard unavailable — silent
		}
	}

	async function attachToUuid(id: number, uuid: string) {
		attachingId = id;
		try {
			const res = await fetch(`/api/inbox/${id}/attach`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ uuid })
			});
			if (!res.ok) {
				lastMsg = `Failed: ${await res.text()}`;
				return;
			}
			lastMsg = 'Attached.';
			await invalidateAll();
		} catch (e) {
			lastMsg = String(e);
		} finally {
			attachingId = null;
		}
	}

	async function dismiss(id: number) {
		if (!confirm('Discard this link?')) return;
		dismissingId = id;
		try {
			const res = await fetch(`/api/inbox/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				lastMsg = `Failed: ${res.status}`;
				return;
			}
			await invalidateAll();
		} finally {
			dismissingId = null;
		}
	}

	function openCreate(id: number, item: InboxItem) {
		creatingFor = id;
		createForm = {
			name: item.title.slice(0, 80),
			suburb: '',
			address: '',
			cuisine: ''
		};
	}

	async function submitCreate(id: number) {
		if (!createForm.name.trim()) return;
		attachingId = id;
		try {
			const res = await fetch(`/api/inbox/${id}/create`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: createForm.name.trim(),
					suburb: createForm.suburb.trim() || null,
					address: createForm.address.trim() || null,
					cuisine: createForm.cuisine
						.split(',')
						.map((c) => c.trim())
						.filter(Boolean)
				})
			});
			if (!res.ok) {
				lastMsg = `Failed: ${await res.text()}`;
				return;
			}
			const r = (await res.json()) as { uuid: string };
			lastMsg = 'Created and attached.';
			await goto(`/restaurant/${r.uuid}`);
		} catch (e) {
			lastMsg = String(e);
		} finally {
			attachingId = null;
			creatingFor = null;
		}
	}

	function openPicker(id: number, prefillQuery: string) {
		pickingFor = id;
		pickerQuery = prefillQuery.split(' ').slice(0, 3).join(' ');
		runPicker();
	}

	let pickerTimer: ReturnType<typeof setTimeout> | null = null;
	function onPickerInput() {
		if (pickerTimer) clearTimeout(pickerTimer);
		pickerTimer = setTimeout(runPicker, 200);
	}

	async function runPicker() {
		if (!pickerQuery.trim() || pickerQuery.trim().length < 2) {
			pickerResults = [];
			return;
		}
		pickerLoading = true;
		try {
			const res = await fetch(`/api/search?q=${encodeURIComponent(pickerQuery)}`);
			if (!res.ok) return;
			const d = (await res.json()) as {
				vault: { uuid: string; name: string; suburb: string | null }[];
			};
			pickerResults = d.vault.map((v) => ({ uuid: v.uuid, name: v.name, suburb: v.suburb }));
		} finally {
			pickerLoading = false;
		}
	}

	onMount(() => {
		// Web Share Target on Android lands here with ?url=… — we deliberately
		// queue it rather than auto-create a restaurant. Sharing-from-other-apps
		// is a "deal with this later" intent; eager extract belongs to the
		// explicit paste-and-tick-the-toggle flow.
		if (data.sharedUrl) {
			urlInput = data.sharedUrl;
			void saveUrl(data.sharedUrl, { forceQueue: true });
		} else {
			void tryPasteFromClipboard();
		}
	});

	function relativeTime(ms: number): string {
		const diff = Date.now() - ms;
		const min = Math.round(diff / 60000);
		if (min < 1) return 'just now';
		if (min < 60) return `${min}m ago`;
		const hr = Math.round(min / 60);
		if (hr < 24) return `${hr}h ago`;
		return `${Math.round(hr / 24)}d ago`;
	}
</script>

<header class="px-5 pt-6 pb-2">
	<BackLink href="/" />
	<h1 class="mt-2 text-2xl font-semibold text-primary">Inbox</h1>
	<p class="mt-1 text-sm text-secondary">
		Paste any link (Instagram reel, TikTok, article, Google Maps share, anything). Known
		publications can be turned into a restaurant immediately; everything else queues here for
		later.
	</p>
</header>

<section class="px-5 pt-3">
	<div class="flex gap-2">
		<input
			type="url"
			bind:value={urlInput}
			placeholder="https://…"
			class="flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:border-accent/60 focus:ring-2 focus:ring-accent-ring/30 focus:outline-none"
			autocomplete="off"
			autocorrect="off"
			autocapitalize="off"
			spellcheck="false"
			oninput={(e) => scheduleDetect((e.currentTarget as HTMLInputElement).value)}
			onkeydown={(e) => {
				if (e.key === 'Enter') void saveUrl(urlInput);
			}}
		/>
		<button
			type="button"
			onclick={() => saveUrl(urlInput)}
			disabled={saving || urlInput.trim().length === 0}
			class="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
		>
			{saving ? '…' : detectedSource && autoImport ? 'Import' : 'Save'}
		</button>
	</div>
	{#if detectedSource}
		<label class="mt-2 flex items-start gap-2 rounded-xl border border-accent/40 bg-accent-soft/40 px-3 py-2 text-xs text-secondary">
			<input
				type="checkbox"
				bind:checked={autoImport}
				class="mt-0.5 h-3.5 w-3.5"
			/>
			<span class="flex-1">
				<span class="font-medium text-accent">{detectedSource.label}</span>
				detected — auto-import as a restaurant.
				<span class="block text-[11px] text-tertiary">
					Untick to queue the link here for later instead.
				</span>
			</span>
		</label>
	{/if}
	<button
		type="button"
		onclick={tryPasteFromClipboard}
		class="mt-2 text-[11px] text-tertiary underline decoration-line-strong underline-offset-2"
	>
		Paste from clipboard
	</button>
	{#if saveError}
		<p class="mt-2 text-xs text-danger">{saveError}</p>
	{/if}
	{#if lastMsg}
		<p class="mt-2 text-xs text-success">{lastMsg}</p>
	{/if}
</section>

{#if mergeContext}
	<MergePicker
		candidates={mergeContext.candidates}
		preview={mergeContext.preview}
		sourceLabel={sourceLabel(mergeContext.source)}
		onPick={mergeInto}
		onCreate={createNewFromMerge}
		onClose={() => (mergeContext = null)}
	/>
{/if}

{#if data.items.length === 0}
	<section class="px-5 pt-8 pb-10">
		<div class="rounded-2xl border border-dashed border-line-strong bg-panel/30 p-6">
			<p class="text-sm text-secondary">
				Nothing pending. Paste a URL above to save it. On Android, you can share a link straight from
				Instagram / TikTok / a browser to Restauranteer.
			</p>
		</div>
	</section>
{:else}
	<section class="grid gap-3 px-5 pt-5 pb-10">
		{#each data.items as item (item.id)}
			{@const primarySuggestion = item.suggestions[0]}
			<article class="overflow-hidden rounded-2xl border border-line bg-panel/50">
				{#if item.image_url}
					<img
						src={item.image_url}
						alt=""
						loading="lazy"
						class="h-32 w-full object-cover"
						referrerpolicy="no-referrer"
					/>
				{/if}
				<div class="p-4">
					<div class="flex items-baseline justify-between gap-2">
						<span class="text-[10px] tracking-widest text-tertiary uppercase"
							>{sourceLabel(item.source)}</span
						>
						<span class="text-[10px] text-tertiary">{relativeTime(item.created_at)}</span>
					</div>
					<h3 class="mt-1 text-sm font-medium text-primary">{item.title}</h3>
					{#if item.excerpt}
						<p class="mt-1 line-clamp-3 text-xs text-secondary">{item.excerpt}</p>
					{/if}
					<a
						href={item.url}
						target="_blank"
						rel="noopener noreferrer"
						class="mt-2 inline-block text-[11px] text-tertiary underline decoration-line-strong underline-offset-2"
					>
						Open ↗
					</a>

					{#if primarySuggestion}
						<button
							type="button"
							onclick={() => attachToUuid(item.id, primarySuggestion.uuid)}
							disabled={attachingId === item.id}
							class="mt-3 w-full rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
						>
							{attachingId === item.id
								? 'Attaching…'
								: `Attach to ${primarySuggestion.name}${primarySuggestion.suburb ? ` · ${primarySuggestion.suburb}` : ''}`}
						</button>
						{#if item.suggestions.length > 1}
							<p class="mt-1 text-[11px] text-tertiary">
								Other matches:
								{#each item.suggestions.slice(1, 4) as s, i (s.uuid)}
									{#if i > 0},{' '}{/if}
									<button
										type="button"
										onclick={() => attachToUuid(item.id, s.uuid)}
										disabled={attachingId === item.id}
										class="text-accent underline decoration-line-strong underline-offset-2 disabled:opacity-50"
									>
										{s.name}{s.suburb ? ` (${s.suburb})` : ''}
									</button>
								{/each}
							</p>
						{/if}
					{:else}
						<p class="mt-3 text-xs text-tertiary">
							No vault match. Pick one or create a new restaurant.
						</p>
					{/if}

					<div class="mt-2 flex gap-2">
						<button
							type="button"
							onclick={() => openPicker(item.id, item.title)}
							class="flex-1 rounded-lg border border-line-strong bg-panel px-3 py-1.5 text-xs text-secondary"
						>
							Pick from vault
						</button>
						<button
							type="button"
							onclick={() => openCreate(item.id, item)}
							class="flex-1 rounded-lg border border-line-strong bg-panel px-3 py-1.5 text-xs text-secondary"
						>
							Create new
						</button>
						<button
							type="button"
							onclick={() => dismiss(item.id)}
							disabled={dismissingId === item.id}
							class="rounded-lg border border-line px-3 py-1.5 text-xs text-tertiary hover:text-danger disabled:opacity-50"
							aria-label="Discard"
						>
							✕
						</button>
					</div>

					{#if creatingFor === item.id}
						<div class="mt-3 rounded-xl border border-line bg-canvas p-3">
							<p class="mb-2 text-[11px] tracking-widest text-tertiary uppercase">New restaurant</p>
							<input
								type="text"
								bind:value={createForm.name}
								placeholder="Name"
								class="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary"
							/>
							<input
								type="text"
								bind:value={createForm.suburb}
								placeholder="Suburb (optional)"
								class="mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary"
							/>
							<input
								type="text"
								bind:value={createForm.address}
								placeholder="Address (optional)"
								class="mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary"
							/>
							<input
								type="text"
								bind:value={createForm.cuisine}
								placeholder="Cuisine (comma-separated, optional)"
								class="mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary"
							/>
							<div class="mt-3 flex gap-2">
								<button
									type="button"
									onclick={() => submitCreate(item.id)}
									disabled={attachingId === item.id || !createForm.name.trim()}
									class="flex-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50"
								>
									{attachingId === item.id ? 'Creating…' : 'Create & attach'}
								</button>
								<button
									type="button"
									onclick={() => (creatingFor = null)}
									class="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-secondary"
								>
									Cancel
								</button>
							</div>
						</div>
					{/if}

					{#if pickingFor === item.id}
						<div class="mt-3 rounded-xl border border-line bg-canvas p-3">
							<input
								type="search"
								bind:value={pickerQuery}
								oninput={onPickerInput}
								placeholder="Search vault…"
								class="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-primary placeholder:text-tertiary"
								autocomplete="off"
								autocorrect="off"
							/>
							{#if pickerLoading}
								<p class="mt-2 text-[11px] text-tertiary">Searching…</p>
							{:else if pickerResults.length === 0 && pickerQuery.trim().length >= 2}
								<p class="mt-2 text-[11px] text-tertiary">No match.</p>
							{/if}
							<ul class="mt-2 space-y-1">
								{#each pickerResults as r (r.uuid)}
									<li>
										<button
											type="button"
											onclick={() => attachToUuid(item.id, r.uuid)}
											disabled={attachingId === item.id}
											class="block w-full rounded-lg border border-line bg-panel/60 px-3 py-2 text-left text-xs text-primary disabled:opacity-50"
										>
											<span class="font-medium">{r.name}</span>
											{#if r.suburb}<span class="text-tertiary"> · {r.suburb}</span>{/if}
										</button>
									</li>
								{/each}
							</ul>
							<button
								type="button"
								onclick={() => (pickingFor = null)}
								class="mt-2 text-[11px] text-tertiary"
							>
								Cancel
							</button>
						</div>
					{/if}
				</div>
			</article>
		{/each}
	</section>
{/if}

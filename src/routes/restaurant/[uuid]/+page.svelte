<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import PhotoCarousel from '$lib/components/PhotoCarousel.svelte';
	import PhotoGrid from '$lib/components/PhotoGrid.svelte';
	import ActionRow from '$lib/components/ActionRow.svelte';
	import ReviewList from '$lib/components/ReviewList.svelte';
	import HoursList from '$lib/components/HoursList.svelte';
	import ListPicker from '$lib/components/ListPicker.svelte';
	import TagEditor from '$lib/components/TagEditor.svelte';
	import LinkArticleSheet from '$lib/components/LinkArticleSheet.svelte';
	import EnrichLocationSheet from '$lib/components/EnrichLocationSheet.svelte';
	import type { EnrichField } from '$lib/components/ActionRow.svelte';
	import EditNameSheet from '$lib/components/EditNameSheet.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import VisitShareSheet from '$lib/components/VisitShareSheet.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import CopyMarkdownButton from '$lib/components/CopyMarkdownButton.svelte';
	import ReviewSummary from '$lib/components/ReviewSummary.svelte';
	import DisclosureSection from '$lib/components/DisclosureSection.svelte';

	let { data }: { data: PageData } = $props();

	type ArticleRef = {
		source: string;
		url: string;
		title: string;
		excerpt: string | null;
		fetched_at: string;
	};
	const SOURCE_LABEL: Record<string, string> = {
		broadsheet: 'Broadsheet',
		goodfood: 'Good Food',
		agfg: 'AGFG',
		applemaps: 'Apple Maps',
		timeout: 'Time Out',
		instagram: 'Instagram',
		tiktok: 'TikTok',
		reddit: 'Reddit',
		tripadvisor: 'TripAdvisor',
		youtube: 'YouTube',
		facebook: 'Facebook',
		yelp: 'Yelp',
		urbanlist: 'The Urban List',
		concreteplayground: 'Concrete Playground'
	};
	// Only adapter-based sources can be re-extracted from their original page;
	// generic links don't have a structured /api/sources/{src}/extract route.
	const REFRESHABLE_SOURCES = new Set(['broadsheet', 'goodfood', 'agfg', 'applemaps']);
	function sourceLabel(source: string): string {
		if (SOURCE_LABEL[source]) return SOURCE_LABEL[source];
		return source.charAt(0).toUpperCase() + source.slice(1);
	}

	const fm = $derived(data.frontmatter);
	const phone = $derived(data.place?.phone ?? (fm.phone as string | undefined) ?? null);
	const website = $derived(data.place?.website ?? (fm.website as string | undefined) ?? null);
	const address = $derived(data.place?.address ?? (fm.address as string | undefined) ?? null);
	const cuisine = $derived((fm.cuisine as string[] | undefined) ?? []);
	const photos = $derived(data.place?.photos ?? []);
	const reviews = $derived(data.place?.reviews ?? []);
	const hours = $derived(data.place?.weekday_descriptions ?? []);
	const articles = $derived((fm.articles as ArticleRef[] | undefined) ?? []);
	const googlePlaceId = $derived(
		(fm.place_ids as Record<string, string> | undefined)?.google ?? null
	);
	const hasExternalSources = $derived(articles.length > 0 || !!googlePlaceId);
	const sourceCount = $derived(articles.length + (googlePlaceId ? 1 : 0));
	const latestVisit = $derived(
		data.bodySections.visits.length > 0
			? data.bodySections.visits[data.bodySections.visits.length - 1]
			: null
	);
	const olderVisits = $derived(data.bodySections.visits.slice(0, -1).reverse());

	type SharedVisit = (typeof data.bodySections.visits)[number];
	let sharingVisit = $state<SharedVisit | null>(null);
	let showAllSources = $state(false);
	let expandedSourceUrls = $state<Set<string>>(new Set());
	const visibleArticles = $derived(showAllSources ? articles : articles.slice(0, 2));

	let editingLists = $state(false);
	let editingTags = $state(false);
	let editingName = $state(false);
	let linkingArticle = $state(false);
	let enrichingField = $state<EnrichField | null>(null);
	let refreshing = $state(false);
	let refreshingArticle = $state<string | null>(null);
	let deletingArticle = $state<string | null>(null);

	async function onSaved() {
		editingLists = false;
		editingTags = false;
		await invalidateAll();
	}

	async function deleteArticle(url: string) {
		if (!confirm('Remove this source from the restaurant?')) return;
		deletingArticle = url;
		try {
			const res = await fetch(
				`/api/restaurants/${data.uuid}/articles?url=${encodeURIComponent(url)}`,
				{ method: 'DELETE' }
			);
			if (!res.ok) {
				alert(`Failed to remove source (${res.status})`);
				return;
			}
			await invalidateAll();
		} finally {
			deletingArticle = null;
		}
	}

	async function onNameSaved(result: { name: string; filePath: string }) {
		editingName = false;
		// Filename may have changed — but the UUID-keyed route stays the same.
		await invalidateAll();
		void result;
	}

	async function refreshAll() {
		refreshing = true;
		try {
			// Visiting the page with ?refresh=1 re-runs the server load with forceRefresh.
			await goto('?refresh=1', { invalidateAll: true });
			history.replaceState({}, '', window.location.pathname);
		} finally {
			refreshing = false;
		}
	}

	async function refreshArticle(url: string, source: string) {
		refreshingArticle = url;
		try {
			await fetch(`/api/sources/${source}/extract`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url, refresh: true })
			});
			await invalidateAll();
		} finally {
			refreshingArticle = null;
		}
	}

	function isExpandableInstagramSource(article: ArticleRef): boolean {
		return article.source === 'instagram' && (article.title.length > 180 || article.title.includes('\n'));
	}

	function toggleSourceText(url: string) {
		const next = new Set(expandedSourceUrls);
		if (next.has(url)) next.delete(url);
		else next.add(url);
		expandedSourceUrls = next;
	}
</script>

<header class="px-5 pt-6 pb-2">
	<div class="flex items-start justify-between gap-2">
		<BackLink href="/" />
		<button
			type="button"
			onclick={refreshAll}
			disabled={refreshing}
			title="Re-fetch cached external data for this restaurant"
			class="rounded-lg border border-line bg-panel/60 px-2 py-1 text-xs text-secondary disabled:opacity-50"
		>
			{refreshing ? '↻ Refreshing…' : '↻ Refresh'}
		</button>
	</div>
	<div class="mt-2 flex items-start justify-between gap-3">
		<h1 class="min-w-0 flex-1 text-2xl font-semibold text-primary">{data.name}</h1>
		{#if data.preferences.show_review_summary && data.visitSummary.count > 0}
			<ReviewSummary summary={data.visitSummary} />
		{/if}
	</div>
	{#if address}
		<p class="mt-0.5 text-sm text-secondary">{address}</p>
	{/if}
	{#if cuisine.length > 0}
		<div class="mt-2 flex flex-wrap gap-1">
			{#each cuisine as c (c)}
				<span class="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-secondary">{c}</span>
			{/each}
		</div>
	{/if}
</header>

{#if photos.length > 0}
	<PhotoCarousel {photos} />
{/if}

<ActionRow
	{phone}
	{website}
	mapsUri={data.place?.google_maps_uri ?? null}
	address={data.place?.address ?? (fm.address as string | undefined) ?? null}
	lat={data.place?.lat ?? data.lat}
	lng={data.place?.lng ?? data.lng}
	name={data.name}
	navigationApp={data.preferences.default_navigation_app}
	inVault={true}
	onEnrich={(field) => (enrichingField = field)}
/>

<div class="px-5 pt-4">
	<a
		href={`/restaurant/${data.uuid}/visit`}
		class="block w-full rounded-2xl bg-accent px-5 py-3 text-center text-sm font-medium text-on-accent"
	>
		📝 Start visit
	</a>
</div>

<section class="px-5 pt-4 pb-2">
	<div class="flex items-center justify-between gap-2">
		<h2 class="text-sm font-medium tracking-wide text-secondary uppercase">Organise</h2>
		<div class="flex items-center gap-3">
			<button type="button" onclick={() => (editingLists = true)} class="text-xs text-accent">
				Lists
			</button>
			<button type="button" onclick={() => (editingTags = true)} class="text-xs text-accent">
				Tags
			</button>
		</div>
	</div>
	<div class="mt-2 flex flex-wrap gap-1">
		{#each data.lists as list (list)}
			<span class="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-secondary">{list}</span>
		{/each}
		{#each data.tags as tag (tag)}
			<span class="rounded-full bg-panel-2/60 px-2 py-0.5 text-xs text-secondary">#{tag}</span>
		{/each}
		{#if data.lists.length === 0 && data.tags.length === 0}
			<span class="text-xs text-tertiary">No lists or tags.</span>
		{/if}
	</div>
</section>

<section class="px-5 pt-4 pb-2">
	<div class="flex items-center justify-between gap-2">
		<h2 class="text-sm font-medium tracking-wide text-secondary uppercase">Sources ({sourceCount})</h2>
		<div class="flex items-center gap-3">
			{#if hasExternalSources}
				<a
					href={`/restaurant/${data.uuid}/compare`}
					class="text-xs text-secondary hover:text-primary"
					title="Compare info across linked sources"
				>
					Compare
				</a>
			{/if}
			<button type="button" onclick={() => (linkingArticle = true)} class="text-xs text-accent">
				Add
			</button>
		</div>
	</div>
	{#if sourceCount === 0}
		<p class="mt-1 text-xs text-tertiary">No sources linked.</p>
	{:else}
		<ul class="mt-2 space-y-2">
			{#if googlePlaceId}
				<li class="rounded-xl border border-line bg-panel/40 p-3">
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs text-tertiary">Google Maps</span>
						{#if data.place?.google_maps_uri}
							<a
								href={data.place.google_maps_uri}
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs text-accent underline decoration-line-strong underline-offset-2"
							>
								Open ↗
							</a>
						{/if}
					</div>
					<p class="mt-1 text-sm font-medium text-primary">Place details linked</p>
				</li>
			{/if}
			{#each visibleArticles as a (a.url)}
				{@const isExpandableInstagram = isExpandableInstagramSource(a)}
				{@const isSourceExpanded = expandedSourceUrls.has(a.url)}
				<li class="rounded-xl border border-line bg-panel/40 p-3">
					<div class="flex items-baseline justify-between gap-2">
						<span class="text-xs text-tertiary">{sourceLabel(a.source)}</span>
						<div class="flex items-center gap-3">
							{#if REFRESHABLE_SOURCES.has(a.source)}
								<button
									type="button"
									onclick={() => refreshArticle(a.url, a.source)}
									disabled={refreshingArticle === a.url}
									title="Re-fetch article from the source"
									class="text-xs text-tertiary hover:text-secondary disabled:opacity-50"
								>
									{refreshingArticle === a.url ? '↻…' : '↻'}
								</button>
							{/if}
							<ShareButton url={a.url} title={`${data.name} — ${a.title}`} />
							<a
								href={a.url}
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs text-accent underline decoration-line-strong underline-offset-2"
							>
								Read ↗
							</a>
							<button
								type="button"
								onclick={() => deleteArticle(a.url)}
								disabled={deletingArticle === a.url}
								title="Remove this source from the restaurant"
								aria-label="Remove source"
								class="text-xs text-tertiary hover:text-danger disabled:opacity-50"
							>
								{deletingArticle === a.url ? '…' : '✕'}
							</button>
						</div>
					</div>
					<p
						class="mt-1 whitespace-pre-line text-sm font-medium text-primary"
						class:line-clamp-3={isExpandableInstagram && !isSourceExpanded}
					>
						{a.title}
					</p>
					{#if isExpandableInstagram}
						<button
							type="button"
							onclick={() => toggleSourceText(a.url)}
							class="mt-1 text-xs text-accent"
							aria-expanded={isSourceExpanded}
						>
							{isSourceExpanded ? 'Show less' : 'Show more'}
						</button>
					{/if}
					{#if a.excerpt && !isExpandableInstagram}
						<p class="mt-1 line-clamp-2 text-sm text-secondary">{a.excerpt}</p>
					{/if}
				</li>
			{/each}
		</ul>
		{#if articles.length > 2}
			<button
				type="button"
				onclick={() => (showAllSources = !showAllSources)}
				class="mt-2 text-xs text-accent"
			>
				{showAllSources ? 'Show fewer' : `Show all ${articles.length}`}
			</button>
		{/if}
	{/if}
</section>

{#if hours.length > 0}
	<section class="px-5 pt-4 pb-2">
		<DisclosureSection title="Hours" meta={`${hours.length} days`}>
			<HoursList lines={hours} />
		</DisclosureSection>
	</section>
{/if}

{#if reviews.length > 0}
	<section class="px-5 pt-4 pb-2">
		<DisclosureSection title="Google reviews" meta={`${reviews.length} reviews`}>
			<ReviewList {reviews} />
		</DisclosureSection>
	</section>
{/if}

{#if data.userPhotos.length > 0}
	<section class="px-5 pt-4 pb-2">
		<h2 class="text-sm font-medium tracking-wide text-secondary uppercase">Your photos</h2>
		<PhotoGrid paths={data.userPhotos} />
	</section>
{/if}

{#if latestVisit}
	<section class="md-body px-5 pt-4 pb-2">
		<h2>Latest visit</h2>
		<article class="md-visit mt-4">
			{@html latestVisit.html}
			<div class="mt-1 flex flex-wrap gap-2">
				<button
					type="button"
					onclick={() => (sharingVisit = latestVisit)}
					class="inline-flex items-center gap-1 rounded-full border border-line-strong bg-panel/70 px-3 py-1 text-xs text-secondary hover:bg-panel-2 hover:text-primary"
				>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="h-3.5 w-3.5"
						aria-hidden="true"
					>
						<path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
						<path d="M16 6l-4-4-4 4" />
						<path d="M12 2v13" />
					</svg>
					Share
				</button>
				<a
					href={`/restaurant/${data.uuid}/visit/${latestVisit.index}/edit`}
					class="inline-flex items-center gap-1 rounded-full border border-line-strong bg-panel/70 px-3 py-1 text-xs text-secondary hover:bg-panel-2 hover:text-primary"
				>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="h-3.5 w-3.5"
						aria-hidden="true"
					>
						<path d="M11 4H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-6" />
						<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
					</svg>
					Edit
				</a>
			</div>
		</article>
	</section>
{/if}

{#if olderVisits.length > 0}
	<section class="px-5 pt-4 pb-2">
		<DisclosureSection title="Past visits" meta={`${olderVisits.length} older`}>
			<div class="md-body">
				{#each olderVisits as v (v.id)}
					<article class="md-visit mt-4 first:mt-0">
						{@html v.html}
						<div class="mt-1 flex flex-wrap gap-2">
							<button
								type="button"
								onclick={() => (sharingVisit = v)}
								class="inline-flex items-center gap-1 rounded-full border border-line-strong bg-panel/70 px-3 py-1 text-xs text-secondary hover:bg-panel-2 hover:text-primary"
							>
								Share
							</button>
							<a
								href={`/restaurant/${data.uuid}/visit/${v.index}/edit`}
								class="inline-flex items-center gap-1 rounded-full border border-line-strong bg-panel/70 px-3 py-1 text-xs text-secondary hover:bg-panel-2 hover:text-primary"
							>
								Edit
							</a>
						</div>
					</article>
				{/each}
			</div>
		</DisclosureSection>
	</section>
{/if}

{#if data.bodySections.beforeVisitsHtml || data.bodySections.afterVisitsHtml}
	<section class="px-5 pt-4 pb-2">
		<DisclosureSection title="Notes">
			<div class="md-body">
				{#if data.bodySections.beforeVisitsHtml}
					{@html data.bodySections.beforeVisitsHtml}
				{/if}
				{#if data.bodySections.afterVisitsHtml}
					{@html data.bodySections.afterVisitsHtml}
				{/if}
			</div>
		</DisclosureSection>
	</section>
{/if}

<div class="px-5 pt-4">
	<button
		type="button"
		onclick={() => (editingName = true)}
		class="block w-full rounded-2xl border border-line bg-panel/60 px-5 py-3 text-center text-sm font-medium text-secondary hover:border-line-strong"
	>
		Edit name
	</button>
</div>

<footer class="mt-auto px-5 pt-4 pb-6 text-xs text-tertiary">
	<div class="mb-2 flex flex-wrap items-center gap-2">
		{#if data.obsidianUri}
			<a
				href={data.obsidianUri}
				class="inline-block rounded-xl border border-line bg-panel/60 px-3 py-1.5 text-xs text-secondary"
			>
				Open in Obsidian
			</a>
		{/if}
		<CopyMarkdownButton
			text={data.rawMarkdown}
			title={data.name}
			label="Copy markdown"
		/>
	</div>
	<DisclosureSection title="Advanced" meta={data.filename}>
		<p class="text-[11px] text-tertiary">Copy markdown shares the full restaurant file.</p>
		<span class="mt-2 block font-mono break-all">{data.filePath}</span>
	</DisclosureSection>
</footer>

{#if editingLists}
	<ListPicker
		restaurantUuid={data.uuid}
		currentLists={data.lists}
		availableLists={data.availableLists}
		onSaved={onSaved}
		onClose={() => (editingLists = false)}
	/>
{/if}

{#if editingTags}
	<TagEditor
		restaurantUuid={data.uuid}
		currentTags={data.tags}
		onSaved={onSaved}
		onClose={() => (editingTags = false)}
	/>
{/if}

{#if linkingArticle}
	<LinkArticleSheet
		restaurantUuid={data.uuid}
		onSaved={() => {
			linkingArticle = false;
			void invalidateAll();
		}}
		onClose={() => (linkingArticle = false)}
	/>
{/if}

{#if sharingVisit}
	<VisitShareSheet
		visit={sharingVisit}
		restaurantName={data.name}
		shareFormat={data.preferences.share_format}
		googlePlaceId={googlePlaceId}
		onClose={() => (sharingVisit = null)}
	/>
{/if}

{#if editingName}
	<EditNameSheet
		restaurantUuid={data.uuid}
		currentName={data.name}
		onSaved={onNameSaved}
		onClose={() => (editingName = false)}
	/>
{/if}

{#if enrichingField}
	<EnrichLocationSheet
		restaurantUuid={data.uuid}
		restaurantName={data.name}
		missingField={enrichingField}
		onSaved={() => {
			enrichingField = null;
			void invalidateAll();
		}}
		onClose={() => (enrichingField = null)}
	/>
{/if}

<script lang="ts">
	import { formatDistance } from '$lib/geo';

	type Candidate = {
		uuid: string;
		name: string;
		suburb: string | null;
		address: string | null;
		score: number;
		distance_m: number | null;
		reason: 'exact_name' | 'name_subset' | 'token_overlap';
	};

	type Outcome =
		| {
				status: 'created' | 'merged' | 'skipped';
				filename: string | null;
				name: string;
				uuid: string;
				filePath: string;
		  }
		| {
				status: 'candidates';
				filename: string | null;
				name: string;
				candidates: Candidate[];
		  }
		| {
				status: 'error';
				filename: string | null;
				name: string;
				error: string;
		  };

	type Resolution = 'create' | 'skip' | string;

	type Props = {
		title?: string;
		outcomes: Outcome[];
		schemaWarning: string | null;
		info?: { app_version?: string; schema_version?: number } | null;
		busy?: boolean;
		onResolve: (resolutions: Record<string, Resolution>) => void;
		onClose: () => void;
	};

	let {
		title = 'Import results',
		outcomes,
		schemaWarning,
		info = null,
		busy = false,
		onResolve,
		onClose
	}: Props = $props();

	let resolutions = $state<Record<string, Resolution>>({});

	const candidatesOutcomes = $derived(
		outcomes.filter((o): o is Outcome & { status: 'candidates' } => o.status === 'candidates')
	);
	const createdCount = $derived(outcomes.filter((o) => o.status === 'created').length);
	const mergedCount = $derived(outcomes.filter((o) => o.status === 'merged').length);
	const skippedCount = $derived(outcomes.filter((o) => o.status === 'skipped').length);
	const errorOutcomes = $derived(outcomes.filter((o) => o.status === 'error'));

	const allResolved = $derived(
		candidatesOutcomes.every((o) => o.filename && resolutions[o.filename])
	);

	function setResolution(filename: string | null, value: Resolution) {
		if (!filename) return;
		resolutions = { ...resolutions, [filename]: value };
	}

	function applyResolutions() {
		// Mark already-handled files as `skip` so the server doesn't redo them.
		const map: Record<string, Resolution> = { ...resolutions };
		for (const o of outcomes) {
			if (!o.filename) continue;
			if (o.status === 'created' || o.status === 'merged' || o.status === 'skipped') {
				map[o.filename] = 'skip';
			}
		}
		onResolve(map);
	}

	function reasonLabel(c: Candidate): string {
		if (c.reason === 'exact_name') return 'same name';
		if (c.reason === 'name_subset') return 'name overlap';
		return 'similar name';
	}
</script>

<div
	class="fixed inset-0 z-40 flex flex-col justify-end bg-overlay"
	role="dialog"
	aria-modal="true"
>
	<button
		type="button"
		class="absolute inset-0 -z-10 h-full w-full cursor-default"
		aria-label="Close"
		onclick={onClose}
	></button>
	<section class="max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-panel p-5 pb-8">
		<header class="mb-3 flex items-center justify-between">
			<h2 class="text-base font-medium text-primary">{title}</h2>
			<button type="button" onclick={onClose} class="text-xs text-secondary">Close</button>
		</header>

		{#if info?.app_version}
			<p class="mb-1 text-[11px] text-tertiary">
				Source bundle from restauranteer v{info.app_version}
				{#if info.schema_version != null}
					· schema v{info.schema_version}
				{/if}
			</p>
		{/if}
		{#if schemaWarning}
			<p class="mb-2 rounded-lg border border-warning/50 bg-warning/10 p-2 text-xs text-rating">
				⚠ {schemaWarning}
			</p>
		{/if}

		<div class="mb-3 grid grid-cols-3 gap-1 text-center text-xs">
			<div class="rounded-lg border border-line bg-panel/60 p-2">
				<div class="text-base font-medium text-success">{createdCount}</div>
				<div class="text-tertiary">created</div>
			</div>
			<div class="rounded-lg border border-line bg-panel/60 p-2">
				<div class="text-base font-medium text-accent">{mergedCount}</div>
				<div class="text-tertiary">merged</div>
			</div>
			<div class="rounded-lg border border-line bg-panel/60 p-2">
				<div class="text-base font-medium text-secondary">{skippedCount}</div>
				<div class="text-tertiary">skipped</div>
			</div>
		</div>

		{#if errorOutcomes.length > 0}
			<details class="mb-3 rounded-lg border border-danger/50 bg-danger/10 p-2 text-xs text-danger">
				<summary class="cursor-pointer">{errorOutcomes.length} file(s) failed</summary>
				<ul class="mt-2 space-y-1 pl-3">
					{#each errorOutcomes as e (e.filename ?? e.name)}
						<li class="break-words">
							<span class="font-medium">{e.name}</span> — {(e as { error: string }).error}
						</li>
					{/each}
				</ul>
			</details>
		{/if}

		{#if candidatesOutcomes.length > 0}
			<p class="mb-2 text-xs tracking-widest text-tertiary uppercase">
				Needs review ({candidatesOutcomes.length})
			</p>
			<ul class="space-y-3">
				{#each candidatesOutcomes as o (o.filename ?? o.name)}
					<li class="rounded-xl border border-line bg-panel/60 p-3">
						<p class="text-sm font-medium text-primary">{o.name}</p>
						{#if o.filename}
							<p class="text-[10px] text-tertiary font-mono">{o.filename}</p>
						{/if}
						<p class="mt-2 text-[11px] tracking-widest text-tertiary uppercase">
							Possible matches
						</p>
						<ul class="mt-1 space-y-1">
							{#each o.candidates as c (c.uuid)}
								<li>
									<button
										type="button"
										onclick={() => setResolution(o.filename, c.uuid)}
										class="flex w-full items-start justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors"
										class:border-accent={o.filename && resolutions[o.filename] === c.uuid}
										class:border-line={!(o.filename && resolutions[o.filename] === c.uuid)}
										class:bg-accent-soft={o.filename && resolutions[o.filename] === c.uuid}
									>
										<div class="min-w-0">
											<p class="truncate text-sm text-primary">{c.name}</p>
											{#if c.suburb || c.address}
												<p class="truncate text-[11px] text-tertiary">{c.suburb ?? c.address}</p>
											{/if}
											<p class="mt-0.5 text-[10px] text-tertiary">
												{reasonLabel(c)}{#if c.distance_m != null}
													· {formatDistance(c.distance_m)} away
												{/if}
											</p>
										</div>
										<span class="shrink-0 text-xs text-accent">
											{o.filename && resolutions[o.filename] === c.uuid ? '✓' : 'Merge →'}
										</span>
									</button>
								</li>
							{/each}
						</ul>
						<div class="mt-2 flex gap-2">
							<button
								type="button"
								onclick={() => setResolution(o.filename, 'create')}
								class="flex-1 rounded-lg border px-3 py-1.5 text-xs text-secondary"
								class:border-accent={o.filename && resolutions[o.filename] === 'create'}
								class:bg-accent-soft={o.filename && resolutions[o.filename] === 'create'}
								class:border-line={!(o.filename && resolutions[o.filename] === 'create')}
							>
								+ Create new
							</button>
							<button
								type="button"
								onclick={() => setResolution(o.filename, 'skip')}
								class="flex-1 rounded-lg border px-3 py-1.5 text-xs"
								class:border-line-strong={o.filename && resolutions[o.filename] === 'skip'}
								class:bg-panel-2={o.filename && resolutions[o.filename] === 'skip'}
								class:border-line={!(o.filename && resolutions[o.filename] === 'skip')}
								class:text-secondary={o.filename && resolutions[o.filename] === 'skip'}
								class:text-tertiary={!(o.filename && resolutions[o.filename] === 'skip')}
							>
								Skip
							</button>
						</div>
					</li>
				{/each}
			</ul>

			<button
				type="button"
				onclick={applyResolutions}
				disabled={!allResolved || busy}
				class="mt-4 w-full rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-on-accent disabled:opacity-50"
			>
				{busy ? 'Applying…' : 'Apply'}
			</button>
		{:else}
			<button
				type="button"
				onclick={onClose}
				class="mt-2 w-full rounded-2xl bg-panel-2 px-5 py-3 text-sm font-medium text-primary"
			>
				Done
			</button>
		{/if}
	</section>
</div>

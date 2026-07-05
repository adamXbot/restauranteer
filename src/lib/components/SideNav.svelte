<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import NavIcon from './NavIcon.svelte';

	type IconName = 'vault' | 'lists' | 'inbox' | 'map' | 'settings';
	type Item = { href: string; icon: IconName; label: string; badge?: number; activeFor?: string[] };

	let { inboxCount = 0, onAdd }: { inboxCount?: number; onAdd?: () => void } = $props();

	const COLLAPSE_KEY = 'restauranteer.sidebarCollapsed';
	let collapsed = $state(false);

	onMount(() => {
		try {
			collapsed = localStorage.getItem(COLLAPSE_KEY) === '1';
		} catch {
			// localStorage may be blocked; default to expanded.
		}
	});

	function toggleCollapsed() {
		collapsed = !collapsed;
		try {
			localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
		} catch {
			// ignore
		}
	}

	const items = $derived<Item[]>([
		{ href: '/', icon: 'vault', label: 'Vault' },
		{ href: '/lists', icon: 'lists', label: 'Lists' },
		{ href: '/inbox', icon: 'inbox', label: 'Inbox', badge: inboxCount },
		// /near rolls up under Discover, matching the mobile bottom nav.
		{ href: '/discover', icon: 'map', label: 'Discover', activeFor: ['/discover', '/near'] }
	]);

	const settingsActive = $derived(page.url.pathname.startsWith('/settings'));

	function isActive(item: Item, pathname: string): boolean {
		if (item.href === '/') return pathname === '/';
		const candidates = item.activeFor ?? [item.href];
		return candidates.some((c) => pathname === c || pathname.startsWith(c + '/'));
	}
</script>

<aside
	class="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-panel transition-[width] duration-200 lg:flex {collapsed
		? 'w-[4.5rem]'
		: 'w-60'}"
>
	<div class="flex items-center gap-2.5 px-4 pt-5 pb-1 {collapsed ? 'justify-center px-0' : ''}">
		<img src="/favicon.svg" alt="" class="h-8 w-8 shrink-0 rounded-lg" />
		{#if !collapsed}
			<span class="truncate text-[15px] font-semibold text-primary">Restauranteer</span>
		{/if}
	</div>

	<div class="mx-3 my-3 border-t border-line"></div>

	<div class="px-3">
		<button
			type="button"
			onclick={() => onAdd?.()}
			aria-label="Add a place"
			title={collapsed ? 'Add a place' : undefined}
			class="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent-soft py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-on-accent {collapsed
				? 'px-0'
				: 'px-3'}"
		>
			<svg
				viewBox="0 0 24 24"
				class="h-4 w-4"
				fill="none"
				stroke="currentColor"
				stroke-width="2.4"
				stroke-linecap="round"
			>
				<path d="M12 5v14M5 12h14" />
			</svg>
			{#if !collapsed}<span>Add a place</span>{/if}
		</button>
	</div>

	<nav class="mt-3 flex flex-col gap-1 px-3" aria-label="Primary">
		{#each items as item (item.href)}
			{@const active = isActive(item, page.url.pathname)}
			<a
				href={item.href}
				aria-current={active ? 'page' : undefined}
				title={collapsed ? item.label : undefined}
				class="relative flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-colors {collapsed
					? 'justify-center px-0'
					: 'px-3'} {active
					? 'bg-accent-soft text-accent'
					: 'text-secondary hover:bg-panel-2 hover:text-primary'}"
			>
				{#if active}
					<span class="absolute top-2 bottom-2 left-0 w-0.5 rounded-r bg-accent"></span>
				{/if}
				<span class="relative">
					<NavIcon name={item.icon} class="h-[18px] w-[18px]" />
					{#if item.badge && item.badge > 0}
						<span
							class="absolute -top-1.5 -right-1.5 flex min-w-4 items-center justify-center rounded-full border border-panel bg-accent px-1 text-[9px] font-semibold text-on-accent"
						>
							{item.badge > 9 ? '9+' : item.badge}
						</span>
					{/if}
				</span>
				{#if !collapsed}<span class="truncate">{item.label}</span>{/if}
			</a>
		{/each}
	</nav>

	<div class="mt-auto flex flex-col gap-1 px-3 pb-4">
		<button
			type="button"
			onclick={toggleCollapsed}
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			class="flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium text-secondary transition-colors hover:bg-panel-2 hover:text-primary {collapsed
				? 'justify-center px-0'
				: 'px-3'}"
		>
			<svg
				viewBox="0 0 24 24"
				class="h-[18px] w-[18px] transition-transform {collapsed ? 'rotate-180' : ''}"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M15 6l-6 6 6 6" /><path d="M20 6v12" />
			</svg>
			{#if !collapsed}<span>Collapse</span>{/if}
		</button>
		<a
			href="/settings"
			aria-current={settingsActive ? 'page' : undefined}
			title={collapsed ? 'Settings' : undefined}
			class="flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-colors {collapsed
				? 'justify-center px-0'
				: 'px-3'} {settingsActive
				? 'bg-accent-soft text-accent'
				: 'text-secondary hover:bg-panel-2 hover:text-primary'}"
		>
			<NavIcon name="settings" class="h-[18px] w-[18px]" />
			{#if !collapsed}<span>Settings</span>{/if}
		</a>
	</div>
</aside>

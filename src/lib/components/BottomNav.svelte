<script lang="ts">
	import { page } from '$app/state';
	import NavIcon from './NavIcon.svelte';

	type IconName = 'vault' | 'lists' | 'inbox' | 'map' | 'settings';
	type Item = {
		href: string;
		icon: IconName;
		label: string;
		primary?: boolean;
		badge?: number;
		activeFor?: string[];
	};

	let { inboxCount = 0 }: { inboxCount?: number } = $props();

	const items = $derived<Item[]>([
		{ href: '/', icon: 'vault', label: 'Vault' },
		{ href: '/lists', icon: 'lists', label: 'Lists' },
		{
			href: '/inbox',
			icon: 'inbox',
			label: 'Inbox',
			primary: true,
			badge: inboxCount
		},
		{
			href: '/discover',
			icon: 'map',
			label: 'Discover',
			// /near rolls up under Discover now — the entry point is on /discover
			activeFor: ['/discover', '/near']
		},
		{ href: '/settings', icon: 'settings', label: 'Settings' }
	]);

	function isActive(item: Item, pathname: string): boolean {
		if (item.href === '/') return pathname === '/';
		const candidates = item.activeFor ?? [item.href];
		return candidates.some((c) => pathname === c || pathname.startsWith(c + '/'));
	}
</script>

<nav
	class="sticky bottom-0 mt-auto grid grid-cols-5 gap-1 border-t border-line bg-canvas/90 px-2 pt-2 pb-2 text-[10px] backdrop-blur"
>
	{#each items as item (item.href)}
		{@const active = isActive(item, page.url.pathname)}
		<a
			href={item.href}
			aria-current={active ? 'page' : undefined}
			aria-label={item.primary ? item.label : undefined}
			class="relative flex flex-col items-center gap-1 rounded-xl py-1.5 {item.primary
				? active
					? 'text-accent'
					: 'text-accent'
				: active
					? 'text-accent'
					: 'text-secondary hover:text-primary'}"
		>
			{#if active && !item.primary}
				<span class="absolute top-0 h-0.5 w-8 rounded-full bg-accent"></span>
			{/if}
			<span class="relative">
				{#if item.primary}
					<span
						class="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg shadow-accent/30"
					>
						<NavIcon name={item.icon} class="h-5 w-5" />
					</span>
				{:else}
					<NavIcon name={item.icon} />
				{/if}
				{#if item.badge && item.badge > 0}
					<span
						class="absolute -top-1 -right-1 min-w-4 rounded-full border border-canvas bg-accent px-1 text-[9px] font-medium text-on-accent"
						aria-label="{item.badge} pending"
					>
						{item.badge > 9 ? '9+' : item.badge}
					</span>
				{/if}
			</span>
			{#if !item.primary}
				<span class={active ? 'font-medium' : ''}>{item.label}</span>
			{/if}
		</a>
	{/each}
</nav>

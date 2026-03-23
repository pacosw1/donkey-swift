<script lang="ts">
	import '../../app.css';
	import { page } from '$app/stores';
	import { logout } from '$lib/api';

	let { children } = $props();

	const tabs = [
		{ id: 'overview', label: 'Overview', icon: 'chart' },
		{ id: 'users', label: 'Users', icon: 'users' },
		{ id: 'events', label: 'Events', icon: 'activity' },
		{ id: 'subscriptions', label: 'Subs', icon: 'credit-card' },
		{ id: 'notifications', label: 'Notifs', icon: 'bell' },
		{ id: 'feedback', label: 'Feedback', icon: 'message' },
		{ id: 'chat', label: 'Chat', icon: 'chat' },
		{ id: 'logs', label: 'Logs', icon: 'terminal' },
		{ id: 'llm-costs', label: 'LLM', icon: 'brain' },
		{ id: 'campaigns', label: 'Campaigns', icon: 'megaphone' }
	];

	let currentPath = $derived($page.url.pathname);
	let isLoginPage = $derived(currentPath === '/admin/login' || currentPath === '/admin/login/');

	function isActive(tabId: string): boolean {
		if (tabId === 'overview') {
			return currentPath === '/admin' || currentPath === '/admin/' || currentPath === '/admin/overview';
		}
		return currentPath.startsWith(`/admin/${tabId}`);
	}
</script>

{#if isLoginPage}
	{@render children()}
{:else}
	<div class="flex h-screen overflow-hidden">
		<!-- Sidebar -->
		<nav class="flex w-48 shrink-0 flex-col border-r border-border bg-bg2">
			<!-- Logo -->
			<div class="flex items-center gap-2 border-b border-border px-4 py-3">
				<span class="text-lg">🫏</span>
				<span class="text-[13px] font-semibold text-text">DonkeyGo</span>
				<span class="ml-auto rounded bg-cyan/10 px-1.5 py-0.5 text-[9px] font-medium text-cyan">ADMIN</span>
			</div>

			<!-- Nav items -->
			<div class="flex-1 overflow-y-auto py-2">
				{#each tabs as tab}
					<a
						href="/admin/{tab.id === 'overview' ? '' : tab.id}"
						class="mx-2 mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[12px] transition-colors
							{isActive(tab.id)
							? 'bg-cyan/10 text-cyan'
							: 'text-text-dim hover:bg-bg3 hover:text-text-soft'}"
					>
						<span class="w-4 text-center">
							{#if tab.icon === 'chart'}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M3 3v18h18" stroke-linecap="round" /><path d="m7 14 4-4 4 4 5-5" stroke-linecap="round" stroke-linejoin="round" /></svg>
							{:else if tab.icon === 'users'}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87m-3-12a4 4 0 0 1 0 7.75" /></svg>
							{:else if tab.icon === 'activity'}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
							{:else if tab.icon === 'credit-card'}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><rect width="22" height="16" x="1" y="4" rx="2" /><path d="M1 10h22" /></svg>
							{:else if tab.icon === 'bell'}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
							{:else if tab.icon === 'message'}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
							{:else if tab.icon === 'chat'}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
							{:else if tab.icon === 'terminal'}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" /></svg>
							{:else if tab.icon === 'brain'}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M9.5 2A6.5 6.5 0 0 0 3 8.5c0 2.7 1.6 5 4 6.2V17a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.3c2.4-1.2 4-3.5 4-6.2A6.5 6.5 0 0 0 10.5 2z" /><path d="M8 21h4" /></svg>
							{:else if tab.icon === 'megaphone'}
								<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="m3 11 18-5v12L3 13v-2z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>
							{/if}
						</span>
						<span>{tab.label}</span>
					</a>
				{/each}
			</div>

			<!-- Footer -->
			<div class="border-t border-border p-3">
				<button
					onclick={logout}
					class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[11px] text-text-dim hover:bg-bg3 hover:text-red transition-colors"
				>
					<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></svg>
					Logout
				</button>
			</div>
		</nav>

		<!-- Main content -->
		<main class="flex-1 overflow-y-auto bg-bg p-6">
			{@render children()}
		</main>
	</div>
{/if}

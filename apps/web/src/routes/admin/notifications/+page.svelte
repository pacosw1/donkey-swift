<script lang="ts">
	import { getNotifications } from '$lib/api';
	import type { Notification } from '$lib/api';
	import { DataTable, Badge, PageLoading, ErrorBanner } from '$lib/components/ui';
	import { timeAgo, truncate } from '$lib/utils';

	let notifications = $state<Notification[]>([]);
	let loading = $state(true);
	let error = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await getNotifications(200);
			notifications = res.notifications ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load notifications';
		} finally {
			loading = false;
		}
	}

	load();

	function kindBadgeVariant(kind: string): 'cyan' | 'gold' | 'green' | 'blue' | 'purple' | 'gray' {
		if (kind.includes('reminder') || kind.includes('hydrat')) return 'cyan';
		if (kind.includes('streak')) return 'gold';
		if (kind.includes('insight') || kind.includes('morning')) return 'purple';
		if (kind.includes('evening') || kind.includes('taper')) return 'blue';
		return 'gray';
	}

	function statusBadgeVariant(status: string): 'green' | 'red' | 'gold' | 'gray' {
		switch (status) {
			case 'sent': case 'delivered': return 'green';
			case 'failed': case 'error': return 'red';
			case 'skipped': return 'gold';
			default: return 'gray';
		}
	}
</script>

<svelte:head>
	<title>Notifications - Admin</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-semibold text-text">Notifications</h1>
		<span class="text-[11px] text-text-dim">{notifications.length} notifications</span>
	</div>

	{#if loading}
		<PageLoading />
	{:else if error}
		<ErrorBanner message={error} onretry={load} />
	{:else}
		<DataTable count={notifications.length} empty="No notifications">
			{#snippet headers()}
				<th class="px-3 py-2">User</th>
				<th class="px-3 py-2">Kind</th>
				<th class="px-3 py-2">Title</th>
				<th class="px-3 py-2">Body</th>
				<th class="px-3 py-2">Status</th>
				<th class="px-3 py-2">Sent</th>
			{/snippet}
			{#snippet rows()}
				{#each notifications as n}
					<tr class="hover:bg-bg3/50 transition-colors">
						<td class="px-3 py-2 text-[11px] text-text-dim">{n.user_email || n.user_id}</td>
						<td class="px-3 py-2">
							<Badge variant={kindBadgeVariant(n.kind)}>{n.kind}</Badge>
						</td>
						<td class="px-3 py-2 max-w-40 truncate" title={n.title}>{n.title}</td>
						<td class="px-3 py-2 max-w-52 text-text-dim">
							<span class="block truncate" title={n.body}>{n.body}</span>
						</td>
						<td class="px-3 py-2">
							<Badge variant={statusBadgeVariant(n.status)}>{n.status}</Badge>
						</td>
						<td class="px-3 py-2 text-text-dim whitespace-nowrap">{timeAgo(n.sent_at)}</td>
					</tr>
				{/each}
			{/snippet}
		</DataTable>
	{/if}
</div>

<script lang="ts">
	import { getSubscriptions } from '$lib/api';
	import type { SubBreakdownRow } from '$lib/api';
	import { StatCard, DataTable, Badge, PageLoading, ErrorBanner } from '$lib/components/ui';
	import { formatNumber } from '$lib/utils';

	let breakdown = $state<SubBreakdownRow[]>([]);
	let loading = $state(true);
	let error = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			const data = await getSubscriptions();
			breakdown = Array.isArray(data) ? data : [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load subscriptions';
		} finally {
			loading = false;
		}
	}

	load();

	let activeCount = $derived(
		breakdown.filter((r) => r.status === 'active').reduce((sum, r) => sum + r.count, 0)
	);
	let totalCount = $derived(breakdown.reduce((sum, r) => sum + r.count, 0));

	function statusBadgeVariant(status: string): 'green' | 'cyan' | 'gold' | 'red' | 'gray' {
		switch (status) {
			case 'active': return 'green';
			case 'trial': return 'cyan';
			case 'expired': return 'red';
			case 'grace_period': return 'gold';
			default: return 'gray';
		}
	}
</script>

<svelte:head>
	<title>Subscriptions - Admin</title>
</svelte:head>

<div class="space-y-4">
	<h1 class="text-lg font-semibold text-text">Subscriptions</h1>

	{#if loading}
		<PageLoading />
	{:else if error}
		<ErrorBanner message={error} onretry={load} />
	{:else}
		<div class="grid grid-cols-3 gap-3">
			<StatCard label="Active" value={formatNumber(activeCount)} color="green" />
			<StatCard label="Total" value={formatNumber(totalCount)} color="cyan" />
			<StatCard label="Statuses" value={breakdown.length} color="gold" />
		</div>

		<DataTable count={breakdown.length} empty="No subscription data">
			{#snippet headers()}
				<th class="px-3 py-2">Status</th>
				<th class="px-3 py-2">Count</th>
				<th class="px-3 py-2">% of Total</th>
			{/snippet}
			{#snippet rows()}
				{#each breakdown as row}
					<tr class="hover:bg-bg3/50 transition-colors">
						<td class="px-3 py-2">
							<Badge variant={statusBadgeVariant(row.status)}>{row.status}</Badge>
						</td>
						<td class="px-3 py-2 tabular-nums">{formatNumber(row.count)}</td>
						<td class="px-3 py-2 text-text-dim tabular-nums">
							{totalCount > 0 ? ((row.count / totalCount) * 100).toFixed(1) : '0.0'}%
						</td>
					</tr>
				{/each}
			{/snippet}
		</DataTable>
	{/if}
</div>

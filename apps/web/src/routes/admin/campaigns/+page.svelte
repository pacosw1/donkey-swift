<script lang="ts">
	import { getCampaigns } from '$lib/api';
	import type { Campaign } from '$lib/api';
	import { DataTable, Badge, PageLoading, ErrorBanner } from '$lib/components/ui';
	import { formatNumber } from '$lib/utils';

	let campaigns = $state<Campaign[]>([]);
	let loading = $state(true);
	let error = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await getCampaigns();
			campaigns = res.campaigns ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load campaigns';
		} finally {
			loading = false;
		}
	}

	load();
</script>

<svelte:head>
	<title>Campaigns - Admin</title>
</svelte:head>

<div class="space-y-4">
	<h1 class="text-lg font-semibold text-text">Campaigns</h1>

	{#if loading}
		<PageLoading />
	{:else if error}
		<ErrorBanner message={error} onretry={load} />
	{:else}
		<DataTable count={campaigns.length} empty="No campaigns yet">
			{#snippet headers()}
				<th class="px-3 py-2">Campaign</th>
				<th class="px-3 py-2">Sent</th>
				<th class="px-3 py-2">Opened</th>
				<th class="px-3 py-2">Clicked</th>
				<th class="px-3 py-2">CTR</th>
				<th class="px-3 py-2">Performance</th>
			{/snippet}
			{#snippet rows()}
				{#each campaigns as c}
					{@const ctr = c.sent > 0 ? ((c.clicked / c.sent) * 100).toFixed(1) : '0.0'}
					{@const openRate = c.sent > 0 ? ((c.opened / c.sent) * 100).toFixed(1) : '0.0'}
					<tr class="hover:bg-bg3/50 transition-colors">
						<td class="px-3 py-2 font-medium text-text-soft">{c.name}</td>
						<td class="px-3 py-2 tabular-nums">{formatNumber(c.sent)}</td>
						<td class="px-3 py-2 tabular-nums">
							{formatNumber(c.opened)}
							<span class="ml-1 text-[10px] text-text-dim">({openRate}%)</span>
						</td>
						<td class="px-3 py-2 tabular-nums">{formatNumber(c.clicked)}</td>
						<td class="px-3 py-2 tabular-nums font-medium text-cyan">{ctr}%</td>
						<td class="px-3 py-2">
							{#if Number(ctr) >= 5}
								<Badge variant="green">Good</Badge>
							{:else if Number(ctr) >= 2}
								<Badge variant="gold">Average</Badge>
							{:else}
								<Badge variant="gray">Low</Badge>
							{/if}
						</td>
					</tr>
				{/each}
			{/snippet}
		</DataTable>
	{/if}
</div>

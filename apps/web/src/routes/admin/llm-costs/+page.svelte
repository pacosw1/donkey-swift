<script lang="ts">
	import { getLLMCosts } from '$lib/api';
	import type { LLMCostSummary } from '$lib/api';
	import { StatCard, DataTable, Badge, PageLoading, ErrorBanner } from '$lib/components/ui';
	import { formatCurrency, formatTokens, formatNumber } from '$lib/utils';

	let data = $state<LLMCostSummary | null>(null);
	let loading = $state(true);
	let error = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			data = await getLLMCosts(30);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load LLM costs';
		} finally {
			loading = false;
		}
	}

	load();
</script>

<svelte:head>
	<title>LLM Costs - Admin</title>
</svelte:head>

<div class="space-y-4">
	<h1 class="text-lg font-semibold text-text">LLM Costs</h1>

	{#if loading}
		<PageLoading />
	{:else if error}
		<ErrorBanner message={error} onretry={load} />
	{:else if data}
		<!-- Summary cards -->
		<div class="grid grid-cols-3 gap-3">
			<StatCard label="Total Cost (30d)" value={formatCurrency(data.total_cost)} color="gold" />
			<StatCard label="Total Tokens" value={formatTokens(data.total_tokens)} color="cyan" />
			<StatCard label="Requests" value={formatNumber(data.total_requests)} color="green" />
		</div>

		<!-- By Feature -->
		{#if data.by_feature && data.by_feature.length > 0}
			<div>
				<h2 class="mb-2 text-[12px] font-medium text-text-soft">Cost by Feature</h2>
				<DataTable count={data.by_feature.length} empty="No feature data">
					{#snippet headers()}
						<th class="px-3 py-2">Feature</th>
						<th class="px-3 py-2">Model</th>
						<th class="px-3 py-2">Requests</th>
						<th class="px-3 py-2">Input Tokens</th>
						<th class="px-3 py-2">Output Tokens</th>
						<th class="px-3 py-2">Cost</th>
					{/snippet}
					{#snippet rows()}
						{#each data?.by_feature ?? [] as row}
							<tr class="hover:bg-bg3/50 transition-colors">
								<td class="px-3 py-2">
									<Badge variant="cyan">{row.feature}</Badge>
								</td>
								<td class="px-3 py-2 text-text-dim">{row.model}</td>
								<td class="px-3 py-2 tabular-nums">{formatNumber(row.requests)}</td>
								<td class="px-3 py-2 tabular-nums text-text-dim">{formatTokens(row.input_tokens)}</td>
								<td class="px-3 py-2 tabular-nums text-text-dim">{formatTokens(row.output_tokens)}</td>
								<td class="px-3 py-2 tabular-nums font-medium text-gold">{formatCurrency(row.cost)}</td>
							</tr>
						{/each}
					{/snippet}
				</DataTable>
			</div>
		{/if}

		<!-- By Model -->
		{#if data.by_model && data.by_model.length > 0}
			<div>
				<h2 class="mb-2 text-[12px] font-medium text-text-soft">Cost by Model</h2>
				<DataTable count={data.by_model.length} empty="No model data">
					{#snippet headers()}
						<th class="px-3 py-2">Model</th>
						<th class="px-3 py-2">Requests</th>
						<th class="px-3 py-2">Input Tokens</th>
						<th class="px-3 py-2">Output Tokens</th>
						<th class="px-3 py-2">Cost</th>
					{/snippet}
					{#snippet rows()}
						{#each data?.by_model ?? [] as row}
							<tr class="hover:bg-bg3/50 transition-colors">
								<td class="px-3 py-2">
									<Badge variant="purple">{row.model}</Badge>
								</td>
								<td class="px-3 py-2 tabular-nums">{formatNumber(row.requests)}</td>
								<td class="px-3 py-2 tabular-nums text-text-dim">{formatTokens(row.input_tokens)}</td>
								<td class="px-3 py-2 tabular-nums text-text-dim">{formatTokens(row.output_tokens)}</td>
								<td class="px-3 py-2 tabular-nums font-medium text-gold">{formatCurrency(row.cost)}</td>
							</tr>
						{/each}
					{/snippet}
				</DataTable>
			</div>
		{/if}
	{/if}
</div>

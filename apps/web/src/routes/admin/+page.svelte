<script lang="ts">
	import { getAnalyticsSummary, getDAU, getMRR } from '$lib/api';
	import type { AnalyticsSummary, DAUEntry, MRRData } from '$lib/api';
	import { StatCard, BarChart, PageLoading, ErrorBanner } from '$lib/components/ui';
	import { formatNumber, formatCurrency, shortDate } from '$lib/utils';

	let summary = $state<AnalyticsSummary | null>(null);
	let dau = $state<DAUEntry[]>([]);
	let mrr = $state<MRRData | null>(null);
	let loading = $state(true);
	let error = $state('');

	let refreshTimer: ReturnType<typeof setInterval> | undefined;

	async function load() {
		try {
			const [s, d, m] = await Promise.all([getAnalyticsSummary(), getDAU(30), getMRR()]);
			summary = s;
			dau = d ?? [];
			mrr = m;
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load dashboard';
		} finally {
			loading = false;
		}
	}

	function startAutoRefresh() {
		refreshTimer = setInterval(load, 30_000);
	}

	function stopAutoRefresh() {
		if (refreshTimer) clearInterval(refreshTimer);
	}

	load().then(startAutoRefresh);

	import { onDestroy } from 'svelte';
	onDestroy(stopAutoRefresh);

	let chartData = $derived(
		dau.map((d) => ({
			label: shortDate(d.date),
			value: d.dau
		}))
	);
</script>

<svelte:head>
	<title>Overview - Admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-semibold text-text">Overview</h1>
		<span class="text-[10px] text-text-dim">Auto-refreshes every 30s</span>
	</div>

	{#if loading}
		<PageLoading />
	{:else if error}
		<ErrorBanner message={error} onretry={load} />
	{:else if summary}
		<!-- Stat cards -->
		<div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
			<StatCard label="DAU" value={formatNumber(summary.dau)} color="cyan" />
			<StatCard label="MAU" value={formatNumber(summary.mau)} color="cyan" />
			<StatCard label="Total Users" value={formatNumber(summary.total_users)} color="gold" />
			<StatCard label="Active Subs" value={formatNumber(summary.active_subscriptions)} color="green" />
			<StatCard
				label="MRR"
				value={mrr ? formatCurrency(mrr.mrr) : '$0.00'}
				color="green"
				sub={mrr ? `${mrr.subscriptions} subscriptions` : ''}
			/>
		</div>

		<!-- DAU Chart -->
		{#if chartData.length > 0}
			<div>
				<h2 class="mb-2 text-[12px] font-medium text-text-soft">Daily Active Users (30 days)</h2>
				<BarChart data={chartData} height={180} />
			</div>
		{/if}
	{/if}
</div>

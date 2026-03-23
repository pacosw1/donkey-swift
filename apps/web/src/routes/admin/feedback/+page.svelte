<script lang="ts">
	import { getFeedback } from '$lib/api';
	import type { Feedback } from '$lib/api';
	import { DataTable, Badge, PageLoading, ErrorBanner } from '$lib/components/ui';
	import { timeAgo } from '$lib/utils';

	let feedback = $state<Feedback[]>([]);
	let loading = $state(true);
	let error = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await getFeedback(200);
			feedback = res.feedback ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load feedback';
		} finally {
			loading = false;
		}
	}

	load();

	function typeBadgeVariant(type: string): 'cyan' | 'gold' | 'green' | 'red' | 'purple' | 'gray' {
		switch (type) {
			case 'bug': return 'red';
			case 'feature': return 'cyan';
			case 'praise': return 'green';
			case 'complaint': return 'gold';
			default: return 'gray';
		}
	}
</script>

<svelte:head>
	<title>Feedback - Admin</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-semibold text-text">Feedback</h1>
		<span class="text-[11px] text-text-dim">{feedback.length} submissions</span>
	</div>

	{#if loading}
		<PageLoading />
	{:else if error}
		<ErrorBanner message={error} onretry={load} />
	{:else}
		<DataTable count={feedback.length} empty="No feedback yet">
			{#snippet headers()}
				<th class="px-3 py-2">User</th>
				<th class="px-3 py-2">Type</th>
				<th class="px-3 py-2">Message</th>
				<th class="px-3 py-2">Version</th>
				<th class="px-3 py-2">Time</th>
			{/snippet}
			{#snippet rows()}
				{#each feedback as fb}
					<tr class="hover:bg-bg3/50 transition-colors">
						<td class="px-3 py-2 text-[11px] text-text-soft">{fb.user_email || fb.user_id}</td>
						<td class="px-3 py-2">
							<Badge variant={typeBadgeVariant(fb.type)}>{fb.type}</Badge>
						</td>
						<td class="px-3 py-2 max-w-96">
							<span class="block text-[11px] text-text-soft whitespace-pre-wrap">{fb.message}</span>
						</td>
						<td class="px-3 py-2 text-text-dim">{fb.app_version || '-'}</td>
						<td class="px-3 py-2 text-text-dim whitespace-nowrap">{timeAgo(fb.created_at)}</td>
					</tr>
				{/each}
			{/snippet}
		</DataTable>
	{/if}
</div>

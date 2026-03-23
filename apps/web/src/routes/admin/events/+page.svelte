<script lang="ts">
	import { getEvents } from '$lib/api';
	import type { AdminEvent } from '$lib/api';
	import { SearchInput, Select, DataTable, Badge, PageLoading, ErrorBanner } from '$lib/components/ui';
	import { timeAgo, truncate } from '$lib/utils';

	let eventFilter = $state('');
	let userIdFilter = $state('');
	let events = $state<AdminEvent[]>([]);
	let loading = $state(true);
	let error = $state('');

	const eventTypes = [
		'app_open', 'app_close', 'water_log', 'goal_updated', 'subscription_started',
		'subscription_expired', 'notification_opened', 'notification_received',
		'onboarding_complete', 'share_card', 'chat_message', 'feedback_submitted'
	].map((e) => ({ value: e, label: e }));

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await getEvents(eventFilter || undefined, userIdFilter || undefined, 100);
			events = res.events ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load events';
		} finally {
			loading = false;
		}
	}

	function handleEventFilter(value: string) {
		eventFilter = value;
		load();
	}

	function handleUserIdFilter(value: string) {
		userIdFilter = value;
		load();
	}

	load();

	function eventBadgeVariant(event: string): 'cyan' | 'gold' | 'green' | 'red' | 'blue' | 'purple' | 'gray' {
		if (event.includes('error') || event.includes('expired')) return 'red';
		if (event.includes('subscription')) return 'gold';
		if (event.includes('water') || event.includes('log')) return 'cyan';
		if (event.includes('notification')) return 'blue';
		if (event.includes('chat')) return 'purple';
		if (event.includes('onboarding') || event.includes('complete')) return 'green';
		return 'gray';
	}
</script>

<svelte:head>
	<title>Events - Admin</title>
</svelte:head>

<div class="space-y-4">
	<h1 class="text-lg font-semibold text-text">Events</h1>

	<div class="flex flex-wrap gap-3">
		<div class="w-56">
			<Select
				value={eventFilter}
				options={eventTypes}
				onchange={handleEventFilter}
				placeholder="All events"
			/>
		</div>
		<div class="flex-1 min-w-48">
			<SearchInput
				value={userIdFilter}
				placeholder="Filter by user ID..."
				oninput={handleUserIdFilter}
			/>
		</div>
	</div>

	{#if loading}
		<PageLoading />
	{:else if error}
		<ErrorBanner message={error} onretry={load} />
	{:else}
		<DataTable count={events.length} empty="No events found">
			{#snippet headers()}
				<th class="px-3 py-2">Event</th>
				<th class="px-3 py-2">User</th>
				<th class="px-3 py-2">Metadata</th>
				<th class="px-3 py-2">Time</th>
			{/snippet}
			{#snippet rows()}
				{#each events as evt}
					<tr class="hover:bg-bg3/50 transition-colors">
						<td class="px-3 py-2">
							<Badge variant={eventBadgeVariant(evt.event)}>{evt.event}</Badge>
						</td>
						<td class="px-3 py-2 text-text-soft text-[11px]">{evt.user_email || evt.user_id}</td>
						<td class="px-3 py-2 max-w-64 text-text-dim text-[11px]">
							<span class="block truncate" title={evt.metadata}>{evt.metadata || '-'}</span>
						</td>
						<td class="px-3 py-2 text-text-dim whitespace-nowrap">{timeAgo(evt.created_at)}</td>
					</tr>
				{/each}
			{/snippet}
		</DataTable>

		<div class="text-[11px] text-text-dim">{events.length} events</div>
	{/if}
</div>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getUsers, getUserDetail, getUserDecisions } from '$lib/api';
	import type { User, UserDetail, UsersResponse, NotificationDecision } from '$lib/api';
	import {
		SearchInput,
		DataTable,
		Badge,
		StatCard,
		PageLoading,
		ErrorBanner
	} from '$lib/components/ui';
	import { timeAgo, fullDate, formatNumber } from '$lib/utils';

	let search = $state('');
	let users = $state<User[]>([]);
	let total = $state(0);
	let offset = $state(0);
	let loading = $state(true);
	let error = $state('');

	// Detail view
	let selectedUser = $state<UserDetail | null>(null);
	let decisions = $state<NotificationDecision[]>([]);
	let detailLoading = $state(false);

	const LIMIT = 50;

	async function loadUsers() {
		loading = true;
		error = '';
		try {
			const res: UsersResponse = await getUsers(search, LIMIT, offset);
			users = res.users ?? [];
			total = res.total;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load users';
		} finally {
			loading = false;
		}
	}

	async function selectUser(id: string) {
		detailLoading = true;
		try {
			const [detail, decs] = await Promise.all([getUserDetail(id), getUserDecisions(id, 50)]);
			selectedUser = detail;
			decisions = decs.decisions ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load user';
		} finally {
			detailLoading = false;
		}
	}

	function closeDetail() {
		selectedUser = null;
		decisions = [];
	}

	function handleSearch(value: string) {
		search = value;
		offset = 0;
		loadUsers();
	}

	function nextPage() {
		if (offset + LIMIT < total) {
			offset += LIMIT;
			loadUsers();
		}
	}

	function prevPage() {
		if (offset > 0) {
			offset = Math.max(0, offset - LIMIT);
			loadUsers();
		}
	}

	loadUsers();

	let currentPage = $derived(Math.floor(offset / LIMIT) + 1);
	let totalPages = $derived(Math.ceil(total / LIMIT));

	function statusBadgeVariant(status: string): 'green' | 'cyan' | 'gold' | 'gray' | 'red' {
		switch (status) {
			case 'pro':
				return 'gold';
			case 'active':
				return 'green';
			case 'churned':
				return 'red';
			default:
				return 'gray';
		}
	}
</script>

<svelte:head>
	<title>Users - Admin</title>
</svelte:head>

<div class="space-y-4">
	{#if selectedUser}
		<!-- Detail View -->
		<div class="space-y-4">
			<button
				onclick={closeDetail}
				class="flex items-center gap-1.5 text-[12px] text-text-dim hover:text-cyan transition-colors"
			>
				<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
					<path d="m15 18-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				Back to users
			</button>

			<h1 class="text-lg font-semibold text-text">{selectedUser.name || selectedUser.email}</h1>

			<!-- Profile grid -->
			<div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
				<div class="rounded-lg border border-border bg-card p-3">
					<div class="text-[10px] uppercase text-text-dim">ID</div>
					<div class="mt-0.5 text-[11px] text-text-soft break-all">{selectedUser.id}</div>
				</div>
				<div class="rounded-lg border border-border bg-card p-3">
					<div class="text-[10px] uppercase text-text-dim">Email</div>
					<div class="mt-0.5 text-[11px] text-text-soft">{selectedUser.email}</div>
				</div>
				<div class="rounded-lg border border-border bg-card p-3">
					<div class="text-[10px] uppercase text-text-dim">Status</div>
					<div class="mt-1">
						<Badge variant={statusBadgeVariant(selectedUser.status)}>{selectedUser.status}</Badge>
					</div>
				</div>
				<div class="rounded-lg border border-border bg-card p-3">
					<div class="text-[10px] uppercase text-text-dim">Subscription</div>
					<div class="mt-0.5 text-[11px] text-text-soft">
						{selectedUser.subscription ? `${selectedUser.subscription.product_id} (${selectedUser.subscription.status})` : 'None'}
					</div>
				</div>
				<div class="rounded-lg border border-border bg-card p-3">
					<div class="text-[10px] uppercase text-text-dim">Created</div>
					<div class="mt-0.5 text-[11px] text-text-soft">{fullDate(selectedUser.created_at)}</div>
				</div>
				<div class="rounded-lg border border-border bg-card p-3">
					<div class="text-[10px] uppercase text-text-dim">Last Login</div>
					<div class="mt-0.5 text-[11px] text-text-soft">{timeAgo(selectedUser.last_login_at)}</div>
				</div>
			</div>

			<!-- Metric cards -->
			<div class="grid grid-cols-3 gap-3">
				<StatCard label="Events" value={formatNumber(selectedUser.event_count)} color="cyan" />
				<StatCard label="Sessions" value={formatNumber(selectedUser.session_count)} color="gold" />
				<StatCard label="Devices" value={formatNumber(selectedUser.device_count)} color="green" />
			</div>

			<!-- Notification Decisions -->
			{#if decisions.length > 0}
				<div>
					<h2 class="mb-2 text-[12px] font-medium text-text-soft">Notification Decision History</h2>
					<DataTable
						count={decisions.length}
						empty="No decisions"
					>
						{#snippet headers()}
							<th class="px-3 py-2">Stage</th>
							<th class="px-3 py-2">Outcome</th>
							<th class="px-3 py-2">Kind</th>
							<th class="px-3 py-2">Reason</th>
							<th class="px-3 py-2">Title</th>
							<th class="px-3 py-2">Time</th>
						{/snippet}
						{#snippet rows()}
							{#each decisions as d}
								<tr class="hover:bg-bg3/50 transition-colors">
									<td class="px-3 py-2"><Badge variant="blue">{d.stage}</Badge></td>
									<td class="px-3 py-2">
										<Badge variant={d.outcome === 'send' ? 'green' : d.outcome === 'skip' ? 'gray' : 'red'}>{d.outcome}</Badge>
									</td>
									<td class="px-3 py-2"><Badge variant="cyan">{d.kind}</Badge></td>
									<td class="px-3 py-2 max-w-48 truncate text-text-dim">{d.reason}</td>
									<td class="px-3 py-2 max-w-48 truncate">{d.title || '-'}</td>
									<td class="px-3 py-2 text-text-dim whitespace-nowrap">{timeAgo(d.created_at)}</td>
								</tr>
							{/each}
						{/snippet}
					</DataTable>
				</div>
			{/if}
		</div>
	{:else}
		<!-- List View -->
		<div class="flex items-center justify-between">
			<h1 class="text-lg font-semibold text-text">Users</h1>
			<span class="text-[11px] text-text-dim">{formatNumber(total)} total</span>
		</div>

		<SearchInput value={search} placeholder="Search by email or name..." oninput={handleSearch} />

		{#if loading}
			<PageLoading />
		{:else if error}
			<ErrorBanner message={error} onretry={loadUsers} />
		{:else}
			<DataTable count={users.length} empty="No users found">
				{#snippet headers()}
					<th class="px-3 py-2">Email</th>
					<th class="px-3 py-2">Name</th>
					<th class="px-3 py-2">Status</th>
					<th class="px-3 py-2">Created</th>
					<th class="px-3 py-2">Last Login</th>
				{/snippet}
				{#snippet rows()}
					{#each users as user}
						<tr
							class="cursor-pointer hover:bg-bg3/50 transition-colors"
							onclick={() => selectUser(user.id)}
							onkeydown={(e) => { if (e.key === 'Enter') selectUser(user.id); }}
							tabindex="0"
							role="button"
						>
							<td class="px-3 py-2 text-text-soft">{user.email}</td>
							<td class="px-3 py-2">{user.name || '-'}</td>
							<td class="px-3 py-2">
								<Badge variant={statusBadgeVariant(user.status)}>{user.status}</Badge>
							</td>
							<td class="px-3 py-2 text-text-dim whitespace-nowrap">{timeAgo(user.created_at)}</td>
							<td class="px-3 py-2 text-text-dim whitespace-nowrap">{timeAgo(user.last_login_at)}</td>
						</tr>
					{/each}
				{/snippet}
			</DataTable>

			<!-- Pagination -->
			{#if totalPages > 1}
				<div class="flex items-center justify-between text-[11px] text-text-dim">
					<span>Page {currentPage} of {totalPages}</span>
					<div class="flex gap-2">
						<button
							onclick={prevPage}
							disabled={offset === 0}
							class="rounded border border-border px-3 py-1 hover:bg-bg3 disabled:opacity-30 transition-colors"
						>
							Prev
						</button>
						<button
							onclick={nextPage}
							disabled={offset + LIMIT >= total}
							class="rounded border border-border px-3 py-1 hover:bg-bg3 disabled:opacity-30 transition-colors"
						>
							Next
						</button>
					</div>
				</div>
			{/if}
		{/if}
	{/if}
</div>

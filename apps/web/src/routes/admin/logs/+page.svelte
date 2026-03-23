<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getLogs } from '$lib/api';
	import { SearchInput, Select, PageLoading, ErrorBanner } from '$lib/components/ui';

	let lines = $state<string[]>([]);
	let filter = $state('');
	let limit = $state(500);
	let loading = $state(true);
	let error = $state('');
	let refreshTimer: ReturnType<typeof setInterval> | undefined;

	const limitOptions = [
		{ value: '100', label: '100 lines' },
		{ value: '500', label: '500 lines' },
		{ value: '1000', label: '1,000 lines' },
		{ value: '5000', label: '5,000 lines' }
	];

	async function load() {
		try {
			const res = await getLogs(limit, filter || undefined);
			lines = res.lines ?? [];
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load logs';
		} finally {
			loading = false;
		}
	}

	function handleFilterChange(value: string) {
		filter = value;
		load();
	}

	function handleLimitChange(value: string) {
		limit = parseInt(value) || 500;
		load();
	}

	function startRefresh() {
		refreshTimer = setInterval(load, 5000);
	}

	load().then(startRefresh);

	onDestroy(() => {
		if (refreshTimer) clearInterval(refreshTimer);
	});

	function colorizeTag(tag: string): string {
		const tagMap: Record<string, string> = {
			ws: 'text-cyan',
			chat: 'text-[#5b8bff]',
			push: 'text-gold',
			dispatch: 'text-green',
			server: 'text-text-dim',
			db: 'text-purple-400',
			error: 'text-red',
			ERROR: 'text-red',
			warn: 'text-gold',
			WARN: 'text-gold',
			info: 'text-cyan',
			INFO: 'text-cyan',
			notif: 'text-gold',
			scheduler: 'text-green',
			llm: 'text-purple-400',
			health: 'text-green',
			analytics: 'text-cyan'
		};
		return tagMap[tag] || 'text-text-dim';
	}

	function parseLine(line: string): { tag: string; rest: string } | null {
		const match = line.match(/^\[([^\]]+)\]\s*(.*)/);
		if (match) return { tag: match[1], rest: match[2] };
		return null;
	}
</script>

<svelte:head>
	<title>Logs - Admin</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-semibold text-text">Logs</h1>
		<div class="flex items-center gap-3">
			<span class="text-[11px] text-text-dim">{lines.length} lines</span>
			<span class="h-2 w-2 rounded-full bg-green animate-pulse" title="Auto-refreshing every 5s"></span>
		</div>
	</div>

	<div class="flex gap-3">
		<div class="flex-1">
			<SearchInput value={filter} placeholder="Filter logs..." oninput={handleFilterChange} debounceMs={500} />
		</div>
		<Select value={String(limit)} options={limitOptions} onchange={handleLimitChange} placeholder="" />
	</div>

	{#if loading}
		<PageLoading />
	{:else if error}
		<ErrorBanner message={error} onretry={load} />
	{:else}
		<div class="rounded-lg border border-border bg-card overflow-hidden">
			<div class="max-h-[calc(100vh-220px)] overflow-y-auto p-3 font-mono text-[11px] leading-5">
				{#if lines.length === 0}
					<div class="text-center text-text-dim py-8">No log entries</div>
				{:else}
					{#each lines as line}
						{@const parsed = parseLine(line)}
						<div class="hover:bg-bg3/30 px-1 -mx-1 rounded transition-colors">
							{#if parsed}
								<span class="{colorizeTag(parsed.tag)} font-medium">[{parsed.tag}]</span>
								<span class="text-text-soft ml-1">{parsed.rest}</span>
							{:else}
								<span class="text-text-soft">{line}</span>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

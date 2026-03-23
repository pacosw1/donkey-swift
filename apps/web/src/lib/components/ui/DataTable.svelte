<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		headers: Snippet;
		rows: Snippet;
		empty?: string;
		count?: number;
	}

	let { headers, rows, empty = 'No data', count }: Props = $props();
</script>

<div class="overflow-x-auto rounded-lg border border-border">
	<table class="w-full text-left text-[12px]">
		<thead>
			<tr class="border-b border-border bg-bg3/50 text-[11px] uppercase tracking-wider text-text-dim">
				{@render headers()}
			</tr>
		</thead>
		<tbody class="divide-y divide-border/50">
			{#if count === 0}
				<tr>
					<td colspan="99" class="px-4 py-8 text-center text-text-dim">{empty}</td>
				</tr>
			{:else}
				{@render rows()}
			{/if}
		</tbody>
	</table>
</div>

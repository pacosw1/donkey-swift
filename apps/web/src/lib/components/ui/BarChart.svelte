<script lang="ts">
	import { cn } from '$lib/utils';

	interface DataPoint {
		label: string;
		value: number;
	}

	interface Props {
		data: DataPoint[];
		height?: number;
		color?: string;
	}

	let { data, height = 160, color = 'bg-cyan' }: Props = $props();

	let maxValue = $derived(Math.max(...data.map((d) => d.value), 1));
</script>

<div class="rounded-lg border border-border bg-card p-4">
	<div class="flex items-end gap-[2px]" style="height: {height}px">
		{#each data as point}
			{@const pct = (point.value / maxValue) * 100}
			<div class="group relative flex flex-1 flex-col items-center justify-end h-full">
				<div
					class={cn('w-full min-w-[3px] rounded-t transition-all duration-200', color, 'opacity-70 group-hover:opacity-100')}
					style="height: {Math.max(pct, 1)}%"
				></div>
				<!-- Tooltip -->
				<div
					class="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded bg-bg4 px-2 py-1 text-[10px] text-text whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 border border-border"
				>
					{point.value} - {point.label}
				</div>
			</div>
		{/each}
	</div>
	<!-- X-axis labels: show first, middle, last -->
	{#if data.length > 0}
		<div class="mt-2 flex justify-between text-[10px] text-text-dim">
			<span>{data[0]?.label ?? ''}</span>
			{#if data.length > 2}
				<span>{data[Math.floor(data.length / 2)]?.label ?? ''}</span>
			{/if}
			<span>{data[data.length - 1]?.label ?? ''}</span>
		</div>
	{/if}
</div>

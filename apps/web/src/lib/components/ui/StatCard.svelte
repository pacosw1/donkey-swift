<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		label: string;
		value: string | number;
		color?: 'cyan' | 'gold' | 'green' | 'red' | 'blue';
		sub?: string;
	}

	let { label, value, color = 'cyan', sub }: Props = $props();

	const colorMap = {
		cyan: 'text-cyan border-cyan/20 bg-cyan/5',
		gold: 'text-gold border-gold/20 bg-gold/5',
		green: 'text-green border-green/20 bg-green/5',
		red: 'text-red border-red/20 bg-red/5',
		blue: 'text-blue border-blue/20 bg-blue/5'
	};
</script>

<div
	class={cn(
		'rounded-lg border px-4 py-3 transition-colors',
		'bg-card border-border hover:border-opacity-50'
	)}
>
	<div class="text-text-dim text-[11px] uppercase tracking-wider">{label}</div>
	<div class={cn('mt-1 text-2xl font-semibold tabular-nums', colorMap[color])}>
		{value}
	</div>
	{#if sub}
		<div class="text-text-dim mt-0.5 text-[11px]">{sub}</div>
	{/if}
</div>

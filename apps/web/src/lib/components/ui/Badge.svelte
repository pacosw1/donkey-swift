<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		variant?: 'default' | 'cyan' | 'gold' | 'green' | 'red' | 'blue' | 'purple' | 'gray';
		class?: string;
		children: import('svelte').Snippet;
	}

	let { variant = 'default', class: className, children }: Props = $props();

	const variants: Record<string, string> = {
		default: 'bg-bg3 text-text-soft border-border',
		cyan: 'bg-cyan/10 text-cyan border-cyan/20',
		gold: 'bg-gold/10 text-gold border-gold/20',
		green: 'bg-green/10 text-green border-green/20',
		red: 'bg-red/10 text-red border-red/20',
		blue: 'bg-blue/10 text-[#5b8bff] border-blue/20',
		purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
		gray: 'bg-bg4 text-text-dim border-border'
	};
</script>

<span
	class={cn(
		'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
		variants[variant],
		className
	)}
>
	{@render children()}
</span>

<script lang="ts">
	interface Props {
		message: string;
		onretry?: () => void;
	}

	let { message, onretry }: Props = $props();
</script>

<div class="rounded-lg border border-red/20 bg-red/5 px-4 py-3 text-[12px] text-red flex items-center gap-3">
	<svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<circle cx="12" cy="12" r="10" stroke-width="2" />
		<path d="M12 8v4m0 4h.01" stroke-width="2" stroke-linecap="round" />
	</svg>
	<span class="flex-1">{message}</span>
	{#if onretry}
		<button
			onclick={onretry}
			class="rounded border border-red/30 px-2 py-1 text-[11px] hover:bg-red/10 transition-colors"
		>
			Retry
		</button>
	{/if}
</div>

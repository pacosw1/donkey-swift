<script lang="ts">
	interface Props {
		value: string;
		placeholder?: string;
		oninput: (value: string) => void;
		debounceMs?: number;
	}

	let { value, placeholder = 'Search...', oninput, debounceMs = 300 }: Props = $props();

	let timer: ReturnType<typeof setTimeout> | undefined;

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			oninput(target.value);
		}, debounceMs);
	}
</script>

<div class="relative">
	<svg
		class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim"
		fill="none"
		stroke="currentColor"
		viewBox="0 0 24 24"
	>
		<circle cx="11" cy="11" r="8" />
		<path d="m21 21-4.35-4.35" stroke-linecap="round" stroke-width="2" />
	</svg>
	<input
		type="text"
		{value}
		{placeholder}
		oninput={handleInput}
		class="w-full rounded-lg border border-border bg-bg2 py-2 pl-10 pr-4 text-[12px] text-text placeholder:text-text-dim/50 focus:border-cyan/40 focus:outline-none focus:ring-1 focus:ring-cyan/20 transition-colors"
	/>
</div>

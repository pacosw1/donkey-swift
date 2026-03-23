<script lang="ts">
	interface Props {
		value: string;
		options: { value: string; label: string }[];
		onchange: (value: string) => void;
		placeholder?: string;
	}

	let { value, options, onchange, placeholder = 'Select...' }: Props = $props();

	function handleChange(e: Event) {
		onchange((e.target as HTMLSelectElement).value);
	}
</script>

<select
	{value}
	onchange={handleChange}
	class="rounded-lg border border-border bg-bg2 px-3 py-2 text-[12px] text-text focus:border-cyan/40 focus:outline-none focus:ring-1 focus:ring-cyan/20 transition-colors appearance-none cursor-pointer pr-8"
	style="background-image: url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%238291af%22><path fill-rule=%22evenodd%22 d=%22M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z%22 clip-rule=%22evenodd%22/></svg>'); background-position: right 0.5rem center; background-repeat: no-repeat; background-size: 1rem;"
>
	{#if placeholder}
		<option value="">{placeholder}</option>
	{/if}
	{#each options as opt}
		<option value={opt.value}>{opt.label}</option>
	{/each}
</select>

<script lang="ts">
	import { counter } from '../composables/counter.svelte';
	import { getContext } from 'svelte';

	let { initialCount }: { initialCount: number } = $props();
	const themeMessage = getContext<string>('themeMessage') ?? 'NO_CONTEXT';
	const { getCount, increment } = counter(initialCount);
</script>

<button onclick={increment}>count is {getCount()} ({themeMessage})</button>

<style>
	@media (prefers-color-scheme: light) {
		button {
			background-color: #ffffff;
		}
	}
</style>

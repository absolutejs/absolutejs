<script lang="ts">
	import { counter } from '../composables/counter.svelte';

	let { initialCount }: { initialCount: number } = $props();
	const { getCount, increment } = counter(initialCount);
</script>

<button onclick={increment}>count is {getCount()}</button>

<style>
	@media (prefers-color-scheme: light) {
		button {
			background-color: #ffffff;
		}
	}
</style>

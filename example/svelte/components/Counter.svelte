<script lang="ts">
	export let initialCount: number;

	import { counter } from '../composables/counter.svelte';
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

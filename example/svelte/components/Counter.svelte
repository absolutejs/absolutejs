<script lang="ts">
	type CounterProps = {
		initialCount: number;
	};

	let { initialCount }: CounterProps = $props();
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

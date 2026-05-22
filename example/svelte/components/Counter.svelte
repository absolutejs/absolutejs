<script lang="ts">
	export let initialCount: number;

	import { counter } from '../composables/counter.svelte';
	import { getContext } from 'svelte';
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

<script lang="ts">
	const delay = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));

	const fastPromise = (async () => {
		await delay(5);

		return 'svelte await fast resolved';
	})();

	const slowPromise = (async () => {
		await delay(20);

		return 'svelte await slow resolved';
	})();
</script>

<svelte:head>
	<title>Svelte Await Streaming Test</title>
</svelte:head>

<main>
	{#await fastPromise}
		<p>fast loading</p>
	{:then value}
		<section>{value}</section>
	{/await}

	{#await slowPromise}
		<p>slow loading</p>
	{:then value}
		<section>{value}</section>
	{/await}
</main>

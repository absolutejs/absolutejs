<script lang="ts">
	import StreamSlot from '../../../src/svelte/components/StreamSlot.svelte';

	let { user = 'guest' }: { user?: string } = $props();

	const delay = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));

	const greeting = async () => {
		await delay(600);

		return `<section>svelte hello ${user}</section>`;
	};

	const awaited = (async () => {
		await delay(20);

		return `svelte await ${user}`;
	})();
</script>

<svelte:head>
	<title>Svelte Partial Prerender Test</title>
</svelte:head>

<main>
	<StreamSlot
		fallbackHtml="<p>svelte static loading</p>"
		id="svelte-static"
		resolve={() => '<section>svelte static resolved</section>'}
	/>
	<StreamSlot
		dynamic
		fallbackHtml="<p>svelte greeting loading</p>"
		id="svelte-greeting"
		resolve={greeting}
	/>

	<!-- absolute:stream dynamic -->
	{#await awaited}
		<p>svelte await loading</p>
	{:then value}
		<section>{value}</section>
	{/await}
</main>

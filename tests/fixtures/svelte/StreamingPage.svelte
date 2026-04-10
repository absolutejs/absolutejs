<script lang="ts">
	import StreamSlot from '../../../src/svelte/components/StreamSlot.svelte';

	const delay = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));

	const renderSlot = async (label: string, delayMs: number) => {
		await delay(delayMs);

		return `<section>${label}</section>`;
	};
</script>

<svelte:head>
	<title>Svelte Streaming Test</title>
</svelte:head>

<main>
	<StreamSlot
		id="svelte-fast"
		fallbackHtml="<p>fast loading</p>"
		resolve={() => renderSlot('svelte fast resolved', 5)}
	/>
	<StreamSlot
		id="svelte-slow"
		fallbackHtml="<p>slow loading</p>"
		resolve={() => renderSlot('svelte slow resolved', 20)}
	/>
</main>

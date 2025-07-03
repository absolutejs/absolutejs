<script lang="ts">
	type SvelteExampleProps = {
		initialCount: number;
	};

	let { initialCount }: SvelteExampleProps = $props();
	let count = $state(initialCount);

	const year = new Date().getFullYear();
</script>

<svelte:head>
	<meta charset="utf-8" />
	<title>Svelte Home</title>
	<meta name="description" content="Welcome to AbsoluteJS" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<link rel="icon" href="/assets/ico/favicon.ico" />
</svelte:head>

<main>
	<header><h1>This page was built with Svelte</h1></header>

	<p>Welcome to the Svelte home page. This page was built using Svelte.</p>

	<p>Counter: {count}</p>
	<button onclick={() => (count += 1)}>Increment</button>

	<div id="links">
		<a href="/">Html</a>
		<a href="/vue">Vue</a>
	</div>

	<footer><p>© {year} AbsoluteJS</p></footer>
</main>

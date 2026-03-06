<script lang="ts">
	type SvelteExampleProps = {
		initialCount: number;
		cssPath?: string;
		cssPaths?: string[];
	};
	import Counter from '../components/Counter.svelte';

	let { initialCount, cssPath, cssPaths = [] }: SvelteExampleProps = $props();
	let isOpen = $state(false);

	let allCssPaths = $derived([...(cssPath ? [cssPath] : []), ...cssPaths]);
</script>

<svelte:head>
	<meta charset="utf-8" />
	<title>AbsoluteJS + Svelte</title>
	<meta name="description" content="AbsoluteJS Svelte Example" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<link rel="icon" href="/assets/ico/favicon.ico" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link
		rel="preconnect"
		href="https://fonts.gstatic.com"
		crossOrigin="anonymous"
	/>
	<link
		href={`https://fonts.googleapis.com/css2?family=Poppins:wght@100..900&display=swap`}
		rel="stylesheet"
	/>
	{#each allCssPaths as path}
		<link rel="stylesheet" href={path} type="text/css" />
	{/each}
</svelte:head>

<header>
	<a href="/">AbsoluteJS</a>
	<details
		open={isOpen}
		onpointerenter={() => (isOpen = true)}
		onpointerleave={() => (isOpen = false)}
	>
		<summary>Pages</summary>
		<nav>
			<a href="/html">HTML</a>
			<a href="/react">React</a>
			<a href="/htmx">HTMX</a>
			<a href="/svelte">Svelte</a>
			<a href="/vue">Vue</a>
			<a href="/angular">Angular</a>
		</nav>
	</details>
</header>

<main>
	<nav>
		<a href="https://absolutejs.com" target="_blank">
			<img
				class="logo"
				src="/assets/png/absolutejs-temp.png"
				alt="AbsoluteJS Logo"
			/>
		</a>
		<a href="https://svelte.dev" target="_blank">
			<img
				class="logo svelte"
				src="/assets/svg/svelte-logo.svg"
				alt="Svelte Logo"
			/>
		</a>
	</nav>
	<h1>AbsoluteJS + Svelte</h1>
	<Counter {initialCount} />
	<p>
		Edit <code>example/svelte/pages/SvelteExample.svelte</code> and save to test
		HMR.
	</p>
	<p style="margin-top: 2rem;">
		Explore the other pages to see how AbsoluteJS seamlessly unifies
		multiple frameworks on a single server.
	</p>
	<p style="color: #777; font-size: 1rem; margin-top: 2rem;">
		Click on the AbsoluteJS and Svelte logos to learn more.
	</p>
</main>

<style>

	.logo.svelte:hover {
		filter: drop-shadow(0 0 2rem #ff3e00);
</style>

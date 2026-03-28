<script lang="ts">
	type SvelteExampleProps = {
		initialCount: number;
		cssPath?: string;
	};
	import Counter from '../components/Counter.svelte';
	import Head from '../../../src/svelte/components/Head.svelte';

	let { initialCount, cssPath }: SvelteExampleProps = $props();
	let isOpen = $state(false);
</script>

<Head
	title="AbsoluteJS + Svelte"
	description="AbsoluteJS Svelte Example"
	font="Poppins"
	{cssPath}
/>

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

<script lang="ts">
	type SvelteExampleProps = {
		initialCount: number;
		cssPath: string;
	};
	import Counter from '../components/Counter.svelte';

	let { initialCount, cssPath }: SvelteExampleProps = $props();
	let isOpen = $state(false);
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
	<link rel="stylesheet" href={cssPath} type="text/css" />
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
		Edit <code>example/svelte/pages/SvelteExample.svelte</code> then save and
		refresh to update the page.
	</p>
	<p style="color: #777">( Hot Module Reloading is coming soon )</p>
	<p style="margin-top: 2rem;">
		Explore the other pages to see how AbsoluteJS seamlessly unifies
		multiple frameworks on a single server.
	</p>
	<p style="color: #777; font-size: 1rem; margin-top: 2rem;">
		Click on the AbsoluteJS and Svelte logos to learn more.
	</p>
</main>

<style>
	header {
		align-items: center;
		background-color: #1a1a1a;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		display: flex;
		justify-content: space-between;
		padding: 2rem;
		text-align: center;
	}

	header a {
		position: relative;
		color: #5fbeeb;
		text-decoration: none;
	}

	header a::after {
		content: '';
		position: absolute;
		left: 0;
		bottom: 0;
		width: 100%;
		height: 2px;
		background: linear-gradient(
			90deg,
			#5fbeeb 0%,
			#35d5a2 50%,
			#ff4b91 100%
		);
		transform: scaleX(0);
		transform-origin: left;
		transition: transform 0.25s ease-in-out;
	}

	header a:hover::after {
		transform: scaleX(1);
	}

	h1 {
		font-size: 2.5rem;
		margin-top: 2rem;
	}

	.logo {
		height: 8rem;
		width: 8rem;
		will-change: filter;
		transition: filter 300ms;
	}

	.logo:hover {
		filter: drop-shadow(0 0 2rem #5fbeeb);
	}

	.logo.svelte:hover {
		filter: drop-shadow(0 0 2rem #ff3e00);
	}

	nav {
		display: flex;
		gap: 4rem;
		justify-content: center;
	}

	header details {
		position: relative;
	}

	header details summary {
		list-style: none;
		appearance: none;
		-webkit-appearance: none;
		cursor: pointer;
		user-select: none;
		color: #5fbeeb;
		font-size: 1.5rem;
		font-weight: 500;
		padding: 0.5rem 1rem;
	}

	header summary::after {
		content: '▼';
		display: inline-block;
		margin-left: 0.5rem;
		font-size: 0.75rem;
		transition: transform 0.3s ease;
	}

	header details[open] summary::after {
		transform: rotate(180deg);
	}

	header details nav {
		position: absolute;
		top: 100%;
		right: -0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: rgba(185, 185, 185, 0.1);
		backdrop-filter: blur(4px);
		border: 1px solid #5fbeeb;
		border-radius: 1rem;
		padding: 1rem 1.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
		opacity: 0;
		transform: translateY(-8px);
		pointer-events: none;
		transition:
			opacity 0.3s ease,
			transform 0.3s ease;
		z-index: 1000;
	}

	header details[open] nav {
		opacity: 1;
		transform: translateY(0);
		pointer-events: auto;
	}

	header details nav a {
		font-size: 1.1rem;
		padding: 0.25rem 0;
		white-space: nowrap;
	}

	@media (prefers-color-scheme: light) {
		header {
			background-color: #ffffff;
		}
	}
</style>

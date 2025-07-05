<script lang="ts">
	type SvelteExampleProps = {
		initialCount: number;
		cssPath: string;
	};
	import Counter from '../components/Counter.svelte';

	let { initialCount, cssPath }: SvelteExampleProps = $props();
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
	<p>AbsoluteJS</p>
	<nav>
		<a href="/">HTML</a>
		<a href="/react">React</a>
		<a href="/svelte">Svelte</a>
		<a href="/vue">Vue</a>
		<a href="/angular">Angular</a>
		<a href="/htmx">HTMX</a>
	</nav>
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

	header p {
		font-size: 3rem;
		font-weight: 700;
	}

	header a::after {
		background: linear-gradient(
			90deg,
			#5fbeeb 0%,
			#35d5a2 50%,
			#ff4b91 100%
		);
		bottom: 0;
		content: '';
		height: 2px;
		left: 0;
		position: absolute;
		transform: scaleX(0);
		transform-origin: left;
		transition: transform 0.25s ease-in-out;
		width: 100%;
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
</style>

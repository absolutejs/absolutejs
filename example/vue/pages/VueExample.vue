<script setup lang="ts">
import { ref } from 'vue';
import CountButton from '../components/CountButton.vue';

const props = defineProps<{
	initialCount: number;
}>();

const count = ref(props.initialCount);
const isOpen = ref(false);
</script>

<template>
	<header>
		<a href="/">AbsoluteJS</a>
		<details
			:open="isOpen"
			@pointerenter="isOpen = true"
			@pointerleave="isOpen = false"
		>
			<summary>Pages</summary>
			<nav>
				<a href="/html">HTML</a>
				<a href="/react">React</a>
				<a href="/htmx">HTMX</a>
				<a href="/svelte">Svelte</a>
				<a href="/vue">Vue</a>
				<!-- <a href="/angular">Angular</a> -->
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
			<a href="https://vuejs.org" target="_blank">
				<img
					class="logo vue"
					src="/assets/svg/vue-logo.svg"
					alt="Vue Logo"
				/>
			</a>
		</nav>
		<h1>AbsoluteJS + Vueqqq</h1>
		<CountButton :initialCount="count" />
		<p>
			Edit <code>example/vue/pages/VueExample.vue</code> and save to test
			HMR.
		</p>
		<p style="margin-top: 2rem">
			Explore the other pages to see how AbsoluteJS seamlessly unifies
			multiple frameworks on a single server.
		</p>
		<p style="color: #777; font-size: 1rem; margin-top: 2rem">
			Click on the AbsoluteJS and Vue logos to learn more.
		</p>
	</main>
</template>

<style scoped>
:global(*) {
	box-sizing: border-box;
	line-height: 1.5;
	margin: 0;
	padding: 0;
}

:global(html) {
	font-family: system-ui, Avenir, Helvetica, Arial, sans-serif;
	height: 100%;
}

:global(body) {
	background-color: #2c2c2c;
	color: #f5f5f5;
	color-scheme: light dark;
	display: flex;
	flex-direction: column;
	font-synthesis: none;
	font-weight: 400;
	height: 100%;
	-moz-osx-font-smoothing: grayscale;
	text-rendering: optimizeLegibility;
	-webkit-font-smoothing: antialiased;
}

:global(#root) {
	display: flex;
	flex-direction: column;
	margin: 0 auto;
	height: 100%;
	width: 100%;
}

:global(main) {
	align-items: center;
	display: flex;
	flex: 1;
	flex-direction: column;
	justify-content: center;
	text-align: center;
}

:global(h1),
:global(h2),
:global(h3),
:global(h4),
:global(h5),
:global(h6) {
	line-height: 1.1;
}

:global(p) {
	font-size: 1.2rem;
	max-width: 1280px;
}

a {
	color: #5fbeeb;
	font-size: 1.5rem;
	font-weight: 500;
	position: relative;
	text-decoration: none;
}

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
	background: linear-gradient(90deg, #5fbeeb 0%, #35d5a2 50%, #ff4b91 100%);
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
.logo.vue:hover {
	filter: drop-shadow(0 0 2rem #42b883);
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
	:global(body) {
		background-color: #f5f5f5;
		color: #1a1a1a;
	}

	header {
		background-color: #ffffff;
	}

	button {
		background-color: #ffffff;
	}
}
</style>

<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
	initialCount: number;
}>();

const count = ref(props.initialCount);
</script>

<template>
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
			<a href="https://vuejs.org" target="_blank">
				<img
					class="logo vue"
					src="/assets/svg/vue-logo.svg"
					alt="Vue Logo"
				/>
			</a>
		</nav>
		<h1>AbsoluteJS + Vue</h1>
		<button @click="count++">count is {{ count }}</button>
		<p>
			Edit <code>example/vue/pages/VueExample.vue</code> then save and
			refresh to update the page.
		</p>
		<p style="color: #777">( Hot Module Reloading is coming soon )</p>
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

main {
	align-items: center;
	display: flex;
	flex: 1;
	flex-direction: column;
	justify-content: center;
	text-align: center;
}

h1,
h2,
h3,
h4,
h5,
h6 {
	line-height: 1.1;
}

p {
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

button {
	background-color: #1a1a1a;
	border: 1px solid transparent;
	border-radius: 0.5rem;
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	cursor: pointer;
	font-family: inherit;
	font-size: 1.1rem;
	font-weight: 500;
	margin: 2rem 0;
	padding: 0.6rem 1.2rem;
	transition: border-color 0.25s;
}
button:hover {
	border-color: #5fbeeb;
}
button:focus,
button:focus-visible {
	outline: 4px auto -webkit-focus-ring-color;
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

header p {
	font-size: 3rem;
	font-weight: 700;
}

header a::after {
	background: linear-gradient(90deg, #5fbeeb 0%, #35d5a2 50%, #ff4b91 100%);
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
.logo.vue:hover {
	filter: drop-shadow(0 0 2rem #42b883);
}

nav {
	display: flex;
	gap: 4rem;
	justify-content: center;
}

@media (prefers-color-scheme: light) {
	body {
		background-color: #f5f5f5;
		color: #1a1a1a;
	}

	button {
		background-color: #ffffff;
	}
}
</style>

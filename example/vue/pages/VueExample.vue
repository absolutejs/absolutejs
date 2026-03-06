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
			<a href="https://vuejs.org" target="_blank">
				<img
					class="logo vue"
					src="/assets/svg/vue-logo.svg"
					alt="Vue Logo"
				/>
			</a>
		</nav>
		<h1>AbsoluteJS + Vue</h1>
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

.logo.vue:hover {
	filter: drop-shadow(0 0 2rem #42b883);
}

@media (prefers-color-scheme: light) {
	:global(body) {
		background-color: #f5f5f5;
		color: #1a1a1a;
	}
}
</style>

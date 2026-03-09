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

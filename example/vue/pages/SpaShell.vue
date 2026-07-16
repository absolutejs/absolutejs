<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';

// SPA shell fixture: lazy child routes with their own scoped styles. The SSR
// handler inlines the matched child's compiled CSS via the page's .spa.json
// side manifest (utils/spaRouteCss.ts) — integration tests cover both the
// first paint and the HMR path (editing a child's style must reach a fresh
// SSR response without a dev-server restart).
export const routes = defineRoutes([
	{
		component: () => import('./SpaOne.vue').then((mod) => mod.default),
		path: '/spashell/one'
	},
	{
		component: () => import('./SpaTwo.vue').then((mod) => mod.default),
		path: '/spashell/two'
	},
	{ path: '/spashell', redirect: '/spashell/one' }
]);
</script>

<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<template>
	<main class="spa-shell">
		<h1>SPA Shell</h1>
		<RouterView />
	</main>
</template>

<style scoped>
.spa-shell {
	padding: 1rem;
	font-family: system-ui, sans-serif;
}
</style>

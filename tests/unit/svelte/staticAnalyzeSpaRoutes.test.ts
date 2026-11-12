import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { analyzeSvelteSpaRoutes } from '../../../src/svelte/staticAnalyzeSpaRoutes';

/* A route's tag can hold arrow functions — `loader={() => import(...)}`,
 * `guard={(nav) => ...}` — whose `>` must not end the tag, or the route
 * goes missing from the SPA manifest and its direct request is a 404. */

const root = join(
	resolve(import.meta.dir, '..', '..', '..'),
	'.test-builds',
	`svelte-spa-routes-${process.pid}`
);

const PAGE = `<script lang="ts">
	import Router from '@absolutejs/absolute/svelte/router/Router.svelte';
	import Route from '@absolutejs/absolute/svelte/router/Route.svelte';
	let { url } = $props();
</script>

<Router guard={(nav) => (nav.to.pathname === '/admin' ? '/login' : undefined)} basepath="/app" {url}>
	<Route path="/" >{#snippet content()}home{/snippet}</Route>
	<Route loader={() => import('./Editor.svelte')} path="/editor/:id" />
	<Route
		guard={async ({ request }) => {
			if (!request) return;
		}}
		path="/settings"
	>
		{#snippet content()}settings{/snippet}
	</Route>
</Router>
`;

beforeAll(async () => {
	await mkdir(join(root, 'pages'), { recursive: true });
	await writeFile(join(root, 'pages', 'SpaPage.svelte'), PAGE);
});

afterAll(async () => {
	await rm(root, { force: true, recursive: true });
});

describe('analyzeSvelteSpaRoutes', () => {
	test('finds routes whose attributes contain arrow functions', async () => {
		const [host] = await analyzeSvelteSpaRoutes(root);

		expect(host?.baseHref).toBe('/app/');
		expect(host?.routes.map((route) => route.path)).toEqual([
			'/',
			'/editor/:id',
			'/settings'
		]);
		expect(host?.routes[1]?.dynamic).toBe(true);
	});
});

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test
} from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBuildPaths } from '../../../src/dev/configResolver';
import { refreshSpaRoutesForFiles } from '../../../src/dev/spaRouteRefresh';
import {
	isKnownSpaRoute,
	setSpaRouteManifest
} from '../../../src/utils/spaRouteManifest';

/* The dev fast paths skip `build()`, where the SPA route table is computed;
 * `refreshSpaRoutesForFiles` re-reads edited files so an added route stops
 * answering 404 and a removed one starts — for every framework whose pages
 * can declare a router. */

let root = '';

const request = (path: string) => new Request(`http://localhost${path}`);

const buildPaths = () =>
	resolveBuildPaths({
		angularDirectory: join(root, 'angular'),
		buildDirectory: join(root, 'build'),
		reactDirectory: join(root, 'react'),
		svelteDirectory: join(root, 'svelte'),
		vueDirectory: join(root, 'vue')
	});

const write = async (relativePath: string, contents: string) => {
	const path = join(root, relativePath);
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, contents);

	return path;
};

const vueShell = (routePaths: string[]) => `<script setup lang="ts">
const label = 'x';
</script>

<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';

export const routes = defineRoutes([
${routePaths.map((path) => `\t{ path: '${path}', component: () => import('./X.vue') },`).join('\n')}
]);
</script>

<template><RouterView /></template>
`;

const reactShell = (
	routePaths: string[]
) => `import { createBrowserRouter } from 'react-router-dom';

export const router = createBrowserRouter(
	[
${routePaths.map((path) => `\t\t{ path: '${path}', element: null },`).join('\n')}
	],
	{ basename: '/r' }
);
`;

const svelteShell = (routePaths: string[]) => `<Router basepath="/s">
${routePaths.map((path) => `\t<Route path="${path}" component={X} />`).join('\n')}
</Router>
`;

const angularShell = (
	routePaths: string[]
) => `import { APP_BASE_HREF } from '@angular/common';
import { provideRouter } from '@angular/router';

export const config = {
	providers: [
		{ provide: APP_BASE_HREF, useValue: '/a/' },
		provideRouter([
${routePaths.map((path) => `\t\t\t{ path: '${path}', component: X },`).join('\n')}
		])
	]
};
`;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-spa-route-refresh-'));
	await mkdir(join(root, 'build'), { recursive: true });
});

afterAll(async () => {
	await rm(root, { force: true, recursive: true });
});

beforeEach(() => setSpaRouteManifest([]));

describe('refreshSpaRoutesForFiles', () => {
	test('Vue: a route added to defineRoutes (after <script setup>) becomes known, a removed one does not', async () => {
		const file = await write(
			'vue/pages/Shell.vue',
			vueShell(['/app/one', '/app/two'])
		);
		await refreshSpaRoutesForFiles([file], buildPaths());
		expect(isKnownSpaRoute('vue', 'Shell', request('/app/three'))).toBe(
			false
		);

		await write(
			'vue/pages/Shell.vue',
			vueShell(['/app/one', '/app/three'])
		);
		const changes = await refreshSpaRoutesForFiles([file], buildPaths());
		expect(changes).toEqual([
			{
				added: ['/app/three'],
				file,
				framework: 'vue',
				removed: ['/app/two']
			}
		]);
		expect(isKnownSpaRoute('vue', 'Shell', request('/app/three'))).toBe(
			true
		);
		expect(isKnownSpaRoute('vue', 'Shell', request('/app/two'))).toBe(
			false
		);
	});

	test('an unchanged file reports no change', async () => {
		const file = await write('vue/pages/Same.vue', vueShell(['/same/one']));
		expect(
			await refreshSpaRoutesForFiles([file], buildPaths())
		).toHaveLength(1);
		expect(await refreshSpaRoutesForFiles([file], buildPaths())).toEqual(
			[]
		);
	});

	test('React: createBrowserRouter edits update the table', async () => {
		const file = await write('react/pages/App.tsx', reactShell(['one']));
		await refreshSpaRoutesForFiles([file], buildPaths());
		expect(isKnownSpaRoute('react', 'App', request('/r/two'))).toBe(false);

		await write('react/pages/App.tsx', reactShell(['one', 'two']));
		await refreshSpaRoutesForFiles([file], buildPaths());
		expect(isKnownSpaRoute('react', 'App', request('/r/two'))).toBe(true);
	});

	test('Svelte: <Router> edits update the table', async () => {
		const file = await write(
			'svelte/pages/Spa.svelte',
			svelteShell(['one'])
		);
		await refreshSpaRoutesForFiles([file], buildPaths());
		expect(isKnownSpaRoute('svelte', 'Spa', request('/s/two'))).toBe(false);

		await write('svelte/pages/Spa.svelte', svelteShell(['one', 'two']));
		await refreshSpaRoutesForFiles([file], buildPaths());
		expect(isKnownSpaRoute('svelte', 'Spa', request('/s/two'))).toBe(true);
	});

	test('Angular: provideRouter edits update the table', async () => {
		const file = await write(
			'angular/pages/portal.ts',
			angularShell(['one'])
		);
		await refreshSpaRoutesForFiles([file], buildPaths());
		expect(isKnownSpaRoute('angular', 'portal', request('/a/two'))).toBe(
			false
		);

		await write('angular/pages/portal.ts', angularShell(['one', 'two']));
		await refreshSpaRoutesForFiles([file], buildPaths());
		expect(isKnownSpaRoute('angular', 'portal', request('/a/two'))).toBe(
			true
		);
	});

	test('a deleted host drops its routes', async () => {
		const file = await write('vue/pages/Gone.vue', vueShell(['/gone/one']));
		await refreshSpaRoutesForFiles([file], buildPaths());
		await rm(file);
		const changes = await refreshSpaRoutesForFiles([file], buildPaths());
		expect(changes[0]?.removed).toEqual(['/gone/one']);
	});

	test('files outside the framework directories are ignored', async () => {
		const file = await write('server.ts', reactShell(['one']));
		expect(await refreshSpaRoutesForFiles([file], buildPaths())).toEqual(
			[]
		);
	});
});

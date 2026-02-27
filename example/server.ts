import { readFileSync } from 'node:fs';
import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';
import { scopedState } from 'elysia-scoped-state';
import { generateHeadElement } from '../src/utils/generateHeadElement';
import { ReactExample } from './react/pages/ReactExample';
import { BuildConfig } from '../types/build';
import {
	asset,
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	handleReactPageRequest
} from '../src';
import { handleAngularPageRequest } from '../src/angular';
import { networking } from '../src/plugins/networking';
import { handleSveltePageRequest } from '../src/svelte';
import { handleVuePageRequest } from '../src/vue';

const isDev = process.env.NODE_ENV === 'development';

const buildConfig: BuildConfig = {
	assetsDirectory: 'example/assets',
	buildDirectory: isDev ? 'example/build' : 'example/dist',
	htmlDirectory: 'example/html',
	htmxDirectory: 'example/htmx',
	angularDirectory: 'example/angular',
	reactDirectory: 'example/react',
	publicDirectory: 'example/public',
	svelteDirectory: 'example/svelte',
	vueDirectory: 'example/vue'
};

let result:
	| Record<string, string>
	| {
			hmrState: import('../src/dev/clientManager').HMRState;
			manifest: Record<string, string>;
	  };

if (isDev) {
	const { devBuild } = await import('../src/build');
	result = await devBuild(buildConfig);
} else if (process.env.ABSOLUTE_BUILD_ONLY) {
	const { build } = await import('../src/build');
	await build(buildConfig);
	process.exit(0);
} else {
	result = JSON.parse(
		readFileSync(`${buildConfig.buildDirectory}/manifest.json`, 'utf-8')
	);
}

export const server = new Elysia()
	.use(
		staticPlugin({
			assets: buildConfig.buildDirectory,
			prefix: ''
		})
	)
	.use(
		scopedState({
			count: { value: 0 }
		})
	)
	.get('/', () => handleHTMLPageRequest(asset(result, 'HtmlExample')))
	.get('/html', () => handleHTMLPageRequest(asset(result, 'HtmlExample')))
	.get('/react', () =>
		handleReactPageRequest(
			ReactExample,
			asset(result, 'ReactExampleIndex'),
			{
				cssPath: asset(result, 'ReactExampleCSS'),
				initialCount: 0
			}
		)
	)
	.get('/svelte', async () => {
		const SvelteExample = (
			await import('./svelte/pages/SvelteExample.svelte')
		).default;

		return handleSveltePageRequest(
			SvelteExample,
			asset(result, 'SvelteExample'),
			asset(result, 'SvelteExampleIndex'),
			{
				cssPath: asset(result, 'SvelteExampleCSS'),
				initialCount: 0
			}
		);
	})
	.get('/vue', async () => {
		const { VueExample } = (await import('./vueImporter')).vueImports;

		return handleVuePageRequest(
			VueExample,
			asset(result, 'VueExample'),
			asset(result, 'VueExampleIndex'),
			generateHeadElement({
				cssPath: asset(result, 'VueExampleCSS'),
				title: 'AbsoluteJS + Vue'
			}),
			{ initialCount: 0 }
		);
	})
	.get('/angular', async () =>
		handleAngularPageRequest(
			() => import('./angular/pages/angular-example'),
			asset(result, 'AngularExample'),
			asset(result, 'AngularExampleIndex'),
			generateHeadElement({
				cssPath: asset(result, 'AngularExampleCSS'),
				title: 'AbsoluteJS + Angular'
			}),
			{ initialCount: 0 }
		)
	)
	.get('/htmx', () => handleHTMXPageRequest(asset(result, 'HTMXExample')))
	.post('/htmx/reset', ({ resetScopedStore }) => resetScopedStore())
	.get('/htmx/count', ({ scopedStore }) => scopedStore.count)
	.post('/htmx/increment', ({ scopedStore }) => ++scopedStore.count)
	.on('error', (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	})
	.use(networking);

if (
	typeof result.hmrState !== 'string' &&
	typeof result.manifest === 'object'
) {
	const { hmr } = await import('../src/plugins/hmr');
	server.use(hmr(result.hmrState, result.manifest));
}

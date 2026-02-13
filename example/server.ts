import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';
import { scopedState } from 'elysia-scoped-state';
import {
	asset,
	createApp,
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	handleReactPageRequest,
	handleSveltePageRequest,
	handleVuePageRequest
} from '../src/core';
import { generateHeadElement } from '../src/utils/generateHeadElement';
import { ReactExample } from './react/pages/ReactExample';
import SvelteExample from './svelte/pages/SvelteExample.svelte';
import { vueImports } from './vueImporter';

const { VueExample } = vueImports;

const buildConfig = {
	assetsDirectory: 'example/assets',
	buildDirectory: 'example/build',
	htmlDirectory: 'example/html',
	htmxDirectory: 'example/htmx',
	options: {
		preserveIntermediateFiles: true
	},
	reactDirectory: 'example/react',
	svelteDirectory: 'example/svelte',
	vueDirectory: 'example/vue'
} as const;

export const server = await createApp(buildConfig, (result) =>
	new Elysia()
		.use(
			staticPlugin({
				assets: result.buildDir,
				prefix: ''
			})
		)
		.use(
			scopedState({
				count: { value: 0 }
			})
		)
		.get('/', () => handleHTMLPageRequest(result, 'HtmlExampleHTML'))
		.get('/html', () => handleHTMLPageRequest(result, 'HtmlExampleHTML'))
		.get('/react', () =>
			handleReactPageRequest(
				ReactExample,
				asset(result.manifest, 'ReactExampleIndex'),
				{
					cssPath: asset(result.manifest, 'ReactExampleCSS'),
					initialCount: 0
				}
			)
		)
		.get('/svelte', async () =>
			handleSveltePageRequest(
				SvelteExample,
				asset(result.manifest, 'SvelteExample'),
				asset(result.manifest, 'SvelteExampleIndex'),
				result,
				{
					cssPath: asset(result.manifest, 'SvelteExampleCSS'),
					initialCount: 0
				}
			)
		)
		.get('/vue', () =>
			handleVuePageRequest(
				VueExample,
				asset(result.manifest, 'VueExample'),
				asset(result.manifest, 'VueExampleIndex'),
				result,
				generateHeadElement({
					cssPath: asset(result.manifest, 'VueExampleCSS'),
					title: 'AbsoluteJS + Vue'
				}),
				{ initialCount: 0 }
			)
		)
		.get('/htmx', () => handleHTMXPageRequest(result, 'HTMXExampleHTMX'))
		.post('/htmx/reset', ({ resetScopedStore }) => resetScopedStore())
		.get('/htmx/count', ({ scopedStore }) => scopedStore.count)
		.post('/htmx/increment', ({ scopedStore }) => ++scopedStore.count)
		.on('error', (error) => {
			const { request } = error;
			console.error(
				`Server error on ${request.method} ${request.url}: ${error.message}`
			);
		})
);

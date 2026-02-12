import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';
import { scopedState } from 'elysia-scoped-state';
import { build } from '../src/core/build';
import { devBuild, hmr } from '../src/dev';
import {
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	handleReactPageRequest,
	handleSveltePageRequest,
	handleVuePageRequest
} from '../src/core/pageHandlers';
import { networking } from '../src/plugins/networking';
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

const isDev = process.env.NODE_ENV !== 'production';

const result = isDev
	? await devBuild(buildConfig)
	: {
			...(await build(buildConfig)),
			hmrState: null
		};

export const server = new Elysia()
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
	.use(result.hmrState ? hmr(result.hmrState, result.manifest) : (app) => app)
	.get('/', () => handleHTMLPageRequest(result, 'HtmlExampleHTML'))
	.get('/html', () => handleHTMLPageRequest(result, 'HtmlExampleHTML'))
	.get('/react', () =>
		handleReactPageRequest(
			ReactExample,
			result.asset('ReactExampleIndex'),
			{
				cssPath: result.asset('ReactExampleCSS'),
				initialCount: 0
			}
		)
	)
	.get('/svelte', async () =>
		handleSveltePageRequest(
			SvelteExample,
			result.asset('SvelteExample'),
			result.asset('SvelteExampleIndex'),
			result,
			{
				cssPath: result.asset('SvelteExampleCSS'),
				initialCount: 0
			}
		)
	)
	.get('/vue', () =>
		handleVuePageRequest(
			VueExample,
			result.asset('VueExample'),
			result.asset('VueExampleIndex'),
			result,
			generateHeadElement({
				cssPath: result.asset('VueExampleCSS'),
				title: 'AbsoluteJS + Vue'
			}),
			{ initialCount: 0 }
		)
	)
	.get('/htmx', () => handleHTMXPageRequest(result, 'HTMXExampleHTMX'))
	.post('/htmx/reset', ({ resetScopedStore }) => resetScopedStore())
	.get('/htmx/count', ({ scopedStore }) => scopedStore.count)
	.post('/htmx/increment', ({ scopedStore }) => ++scopedStore.count)
	.post('/htmx/sync-count', ({ body, scopedStore }) => {
		if (body && typeof body === 'object' && 'count' in body) {
			scopedStore.count = Number(body.count);
			return { success: true };
		}
		return { success: false };
	})
	.use(networking({ hmrState: result.hmrState }))
	.on('error', (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	});

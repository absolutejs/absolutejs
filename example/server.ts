import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';
import { scopedState } from 'elysia-scoped-state';
import { generateHeadElement } from '../src/utils/generateHeadElement';
import { ReactExample } from './react/pages/ReactExample';
import SvelteExample from './svelte/pages/SvelteExample.svelte';
import { vueImports } from './vueImporter';
import { BuildConfig } from '../types/build';
import { env } from 'bun';
import {
	asset,
	build,
	devBuild,
	handleAngularPageRequest,
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	handleReactPageRequest,
	handleSveltePageRequest,
	handleVuePageRequest,
	hmr
} from '../src';
import { networking } from '../src/plugins/networking';

const { VueExample } = vueImports;

const buildConfig: BuildConfig = {
	assetsDirectory: 'example/assets',
	buildDirectory: 'example/build',
	htmlDirectory: 'example/html',
	htmxDirectory: 'example/htmx',
	angularDirectory: 'example/angular',
	reactDirectory: 'example/react',
	publicDirectory: 'example/public',
	svelteDirectory: 'example/svelte',
	vueDirectory: 'example/vue'
};

const isDev = env.NODE_ENV === 'development';
const result = isDev ? await devBuild(buildConfig) : await build(buildConfig);

// Load Angular component using type-safe utility
import { loadAngularComponent } from '../src/utils/loadAngularComponent';

const angularModule = await loadAngularComponent(
	'example/angular/compiled',
	'angular-example.js'
);
const AngularExampleComponent = angularModule.default;
const CSS_PATH_TOKEN = angularModule.CSS_PATH;
const INITIAL_COUNT_TOKEN = angularModule.INITIAL_COUNT;

export const server = new Elysia()
	.use(
		staticPlugin({
			assets: './example/build',
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
	.get('/svelte', async () =>
		handleSveltePageRequest(
			SvelteExample,
			asset(result, 'SvelteExample'),
			asset(result, 'SvelteExampleIndex'),
			{
				cssPath: asset(result, 'SvelteExampleCSS'),
				initialCount: 0
			}
		)
	)
	.get('/vue', () =>
		handleVuePageRequest(
			VueExample,
			asset(result, 'VueExample'),
			asset(result, 'VueExampleIndex'),
			generateHeadElement({
				cssPath: asset(result, 'VueExampleCSS'),
				title: 'AbsoluteJS + Vue'
			}),
			{ initialCount: 0 }
		)
	)
	.get('/angular', async () =>
		handleAngularPageRequest(
			AngularExampleComponent,
			asset(result, 'AngularExampleIndex'),
			{
				initialCount: 0,
				cssPath: asset(result, 'AngularExampleCSS')
			},
			undefined,
			{
				CSS_PATH: CSS_PATH_TOKEN,
				INITIAL_COUNT: INITIAL_COUNT_TOKEN
			}
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
	server.use(hmr(result.hmrState, result.manifest));
}

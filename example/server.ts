import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';
import { scopedState } from 'elysia-scoped-state';
import { build } from '../src/core/build';
import { asset } from '../src/core/lookup';
import {
	handleAngularPageRequest,
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

const manifest = await build({
	assetsDirectory: 'example/assets',
	buildDirectory: 'example/build',
	htmlDirectory: 'example/html',
	htmxDirectory: 'example/htmx',
	angularDirectory: 'example/angular',
	options: {
		preserveIntermediateFiles: true
	},
	reactDirectory: 'example/react',
	svelteDirectory: 'example/svelte',
	vueDirectory: 'example/vue'
});

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
	.get('/', () =>
		handleHTMLPageRequest('./example/build/html/pages/HtmlExample.html')
	)
	.get('/html', () =>
		handleHTMLPageRequest('./example/build/html/pages/HtmlExample.html')
	)
	.get('/react', () =>
		handleReactPageRequest(
			ReactExample,
			asset(manifest, 'ReactExampleIndex'),
			{
				cssPath: asset(manifest, 'ReactExampleCSS'),
				initialCount: 0
			}
		)
	)
	.get('/svelte', async () =>
		handleSveltePageRequest(
			SvelteExample,
			asset(manifest, 'SvelteExample'),
			asset(manifest, 'SvelteExampleIndex'),
			{
				cssPath: asset(manifest, 'SvelteExampleCSS'),
				initialCount: 0
			}
		)
	)
	.get('/vue', () =>
		handleVuePageRequest(
			VueExample,
			asset(manifest, 'VueExample'),
			asset(manifest, 'VueExampleIndex'),
			generateHeadElement({
				cssPath: asset(manifest, 'VueExampleCSS'),
				title: 'AbsoluteJS + Vue'
			}),
			{ initialCount: 0 }
		)
	)
	.get('/angular', async () =>
		handleAngularPageRequest(
			AngularExampleComponent,
			asset(manifest, 'AngularExampleIndex'),
			{
				initialCount: 0,
				cssPath: asset(manifest, 'AngularExampleCSS')
			},
			undefined,
			{
				CSS_PATH: CSS_PATH_TOKEN,
				INITIAL_COUNT: INITIAL_COUNT_TOKEN
			}
		)
	)
	.get('/htmx', () =>
		handleHTMXPageRequest('./example/build/htmx/pages/HTMXExample.html')
	)
	.post('/htmx/reset', ({ resetScopedStore }) => resetScopedStore())
	.get('/htmx/count', ({ scopedStore }) => scopedStore.count)
	.post('/htmx/increment', ({ scopedStore }) => ++scopedStore.count)
	.use(networking)
	.on('error', (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	});

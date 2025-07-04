import { staticPlugin } from '@elysiajs/static';
import { file } from 'bun';
import { Elysia } from 'elysia';
import { build } from '../src/core/build';
import { asset } from '../src/core/lookup';
import {
	handleHTMLPageRequest,
	handleReactPageRequest,
	handleSveltePageRequest,
	handleVuePageRequest
} from '../src/core/pageHandlers';
import { networkingPlugin } from '../src/plugins/networkingPlugin';
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
	options: {
		preserveIntermediateFiles: true
	},
	reactDirectory: 'example/react',
	svelteDirectory: 'example/svelte',
	vueDirectory: 'example/vue'
});

let counter = 0;

export const server = new Elysia()
	.use(
		staticPlugin({
			assets: './example/build',
			prefix: ''
		})
	)
	.get('/', () =>
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
			{ cssPath: asset(manifest, 'SvelteExampleCSS'), initialCount: 0 }
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
	.get('/htmx', () => file('./example/build/htmx/HtmxHome.html'))
	.get('/htmx/increment', () => {
		counter++;

		return new Response(counter.toString(), {
			headers: { 'Content-Type': 'text/plain' }
		});
	})
	.use(networkingPlugin)
	.on('error', (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	});

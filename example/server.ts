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

// Dynamically import Angular components after compilation
// Angular compiles to example/angular/compiled/ (not example/build/compiled/)
// The server component is in the compiled output directory
// Find the actual compiled file path (may be deeply nested)
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const findAngularComponent = (dir: string, filename: string): string | null => {
	try {
		const entries = readdirSync(dir);
		for (const entry of entries) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				const found = findAngularComponent(fullPath, filename);
				if (found) return found;
			} else if (entry === filename) {
				return fullPath;
			}
		}
	} catch {
		// Ignore errors
	}
	return null;
};

const angularCompiledDir = resolve(process.cwd(), 'example/angular/compiled');
const angularServerFile = findAngularComponent(angularCompiledDir, 'angular-example.js');
if (!angularServerFile) {
	throw new Error('Angular compiled component not found');
}

// Use absolute path for import
const angularModule = await import(angularServerFile);
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

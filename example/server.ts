import { Elysia } from 'elysia';
import { scopedState } from 'elysia-scoped-state';
import { generateHeadElement } from '../src/utils/generateHeadElement';
import { ReactExample } from './react/pages/ReactExample';
import {
	asset,
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	handleReactPageRequest,
	prepare
} from '../src';
import { handleAngularPageRequest } from '../src/angular';
import { networking } from '../src/plugins/networking';
import { handleSveltePageRequest } from '../src/svelte';
import { handleVuePageRequest } from '../src/vue';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.use(
		scopedState({
			count: { value: 0 }
		})
	)
	.get('/', () => handleHTMLPageRequest(asset(manifest, 'HTMLExample')))
	.get('/html', () => handleHTMLPageRequest(asset(manifest, 'HTMLExample')))
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
	.get('/svelte', async () => {
		const SvelteExample = (
			await import('./svelte/pages/SvelteExample.svelte')
		).default;

		return handleSveltePageRequest(
			SvelteExample,
			asset(manifest, 'SvelteExample'),
			asset(manifest, 'SvelteExampleIndex'),
			{
				cssPath: asset(manifest, 'SvelteExampleCSS'),
				initialCount: 0
			}
		);
	})
	.get('/vue', async () => {
		const { VueExample } = (await import('./vueImporter')).vueImports;

		return handleVuePageRequest(
			VueExample,
			asset(manifest, 'VueExample'),
			asset(manifest, 'VueExampleIndex'),
			generateHeadElement({
				cssPath: [
					asset(manifest, 'VueExampleCSS'),
					asset(manifest, 'VueExampleCompiledCSS')
				],
				title: 'AbsoluteJS + Vue'
			}),
			{ initialCount: 0 }
		);
	})
	.get('/angular', async () =>
		handleAngularPageRequest(
			() => import('./angular/pages/angular-example'),
			asset(manifest, 'AngularExample'),
			asset(manifest, 'AngularExampleIndex'),
			generateHeadElement({
				cssPath: asset(manifest, 'AngularExampleCSS'),
				title: 'AbsoluteJS + Angular'
			}),
			{ initialCount: 0 }
		)
	)
	.get('/htmx', () => handleHTMXPageRequest(asset(manifest, 'HTMXExample')))
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

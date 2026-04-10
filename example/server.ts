import { Elysia } from 'elysia';
import { scopedState } from 'elysia-scoped-state';
import type * as AngularExamplePage from './angular/pages/angular-example';
import type SvelteExample from './svelte/pages/SvelteExample.svelte';
import type VueExample from './vue/pages/VueExample.vue';
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
		handleReactPageRequest({
			Page: ReactExample,
			index: asset(manifest, 'ReactExampleIndex'),
			props: {
				cssPath: asset(manifest, 'ReactExampleCSS'),
				initialCount: 0
			}
		})
	)
	.get('/svelte', () =>
		handleSveltePageRequest<typeof SvelteExample>({
			indexPath: asset(manifest, 'SvelteExampleIndex'),
			pagePath: asset(manifest, 'SvelteExample'),
			props: {
				cssPath: asset(manifest, 'SvelteExampleCSS'),
				initialCount: 0
			}
		})
	)
	.get('/vue', () =>
		handleVuePageRequest<typeof VueExample>({
			headTag: generateHeadElement({
				cssPath: [
					asset(manifest, 'VueExampleCSS'),
					asset(manifest, 'VueExampleCompiledCSS')
				],
				title: 'AbsoluteJS + Vue'
			}),
			indexPath: asset(manifest, 'VueExampleIndex'),
			pagePath: asset(manifest, 'VueExample'),
			props: { initialCount: 0 }
		})
	)
	.get('/angular', async () =>
		handleAngularPageRequest<typeof AngularExamplePage>({
			headTag: generateHeadElement({
				cssPath: asset(manifest, 'AngularExampleCSS'),
				title: 'AbsoluteJS + Angular'
			}),
			indexPath: asset(manifest, 'AngularExampleIndex'),
			pagePath: asset(manifest, 'AngularExample'),
			props: { initialCount: 0 }
		})
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

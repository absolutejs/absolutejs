import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { defineComponent, h } from 'vue';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const SVELTE_FIXTURE = resolve(
	PROJECT_ROOT,
	'tests',
	'fixtures',
	'svelte',
	'StreamingPage.svelte'
);
const ANGULAR_FIXTURE = resolve(
	PROJECT_ROOT,
	'tests',
	'fixtures',
	'angular',
	'streaming-page.built.ts'
);

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

describe('streaming across built non-react framework entrypoints', () => {
	test('setup: build package dist once for built-entrypoint tests', async () => {
		await ensureDistBuild();
	}, 240_000);

	test('svelte publishes explicit component entrypoints for streaming primitives', async () => {
		expect(
			existsSync(
				resolve(
					PROJECT_ROOT,
					'dist/svelte/components/StreamSlot.svelte'
				)
			)
		).toBe(true);
		expect(
			existsSync(
				resolve(
					PROJECT_ROOT,
					'dist/svelte/components/AwaitSlot.svelte'
				)
			)
		).toBe(true);
	});

	test('svelte built entrypoint injects runtime and patches', async () => {
		const { handleSveltePageRequest } = await import(
			resolve(PROJECT_ROOT, 'dist/svelte/index.js')
		);

		const response = await handleSveltePageRequest({
			collectStreamingSlots: true,
			indexPath: '/svelte-built-test-index.js',
			pagePath: SVELTE_FIXTURE
		});
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"svelte-fast"');
		const slowPatchIndex = html.indexOf('"svelte-slow"');

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="svelte-fast"');
		expect(html).toContain('id="svelte-slow"');
		expect(html).toContain('svelte fast resolved');
		expect(html).toContain('svelte slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});

	test('vue built entrypoint injects runtime and patches', async () => {
		const { handleVuePageRequest } = await import(
			resolve(PROJECT_ROOT, 'dist/vue/index.js')
		);
		const { StreamSlot } = await import(
			resolve(PROJECT_ROOT, 'dist/vue/components/index.js')
		);

		const Page = defineComponent({
			name: 'BuiltVueStreamingTestPage',
			setup() {
				return () =>
					h('html', { lang: 'en' }, [
						h('head', [h('title', 'Built Vue Streaming Test')]),
						h('body', [
							h('main', [
								h(StreamSlot, {
									fallbackHtml: '<p>fast loading</p>',
									id: 'built-vue-fast',
									resolve: async () => {
										await delay(5);

										return '<section>built vue fast resolved</section>';
									}
								}),
								h(StreamSlot, {
									fallbackHtml: '<p>slow loading</p>',
									id: 'built-vue-slow',
									resolve: async () => {
										await delay(20);

										return '<section>built vue slow resolved</section>';
									}
								})
							])
						])
					]);
			}
		});

		const response = await handleVuePageRequest({
			collectStreamingSlots: true,
			headTag: '<head><title>Built Vue Streaming Test</title></head>',
			indexPath: '/vue-built-test-index.js',
			Page,
			pagePath: '/tests/built-inline.vue'
		});
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"built-vue-fast"');
		const slowPatchIndex = html.indexOf('"built-vue-slow"');

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="built-vue-fast"');
		expect(html).toContain('id="built-vue-slow"');
		expect(html).toContain('built vue fast resolved');
		expect(html).toContain('built vue slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});

	test('angular built entrypoint injects runtime and patches', async () => {
		const { handleAngularPageRequest } = await import(
			resolve(PROJECT_ROOT, 'dist/angular/index.js')
		);

		const response = await handleAngularPageRequest({
			collectStreamingSlots: true,
			headTag: '<head><title>Built Angular Streaming Test</title></head>',
			indexPath: '/angular-built-test-index.js',
			pagePath: ANGULAR_FIXTURE
		});
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"angular-fast"');
		const slowPatchIndex = html.indexOf('"angular-slow"');

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="angular-fast"');
		expect(html).toContain('id="angular-slow"');
		expect(html).toContain('angular fast resolved');
		expect(html).toContain('angular slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});
});

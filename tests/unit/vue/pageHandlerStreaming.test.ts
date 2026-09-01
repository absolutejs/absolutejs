import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineAsyncComponent, defineComponent, h } from 'vue';
import { handleVuePageRequest } from '../../../src/vue';
import { StreamSlot, SuspenseSlot } from '../../../src/vue/components';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const resolveVueSuspenseValue = async () => {
	await delay(5);

	return {
		label: 'vue suspense resolved'
	};
};

const VueStreamingTestPage = defineComponent({
	name: 'VueStreamingTestPage',
	setup() {
		return () =>
			h('html', { lang: 'en' }, [
				h('head', [h('title', 'Vue Streaming Test')]),
				h('body', [
					h('main', [
						h(StreamSlot, {
							fallbackHtml: '<p>fast loading</p>',
							id: 'vue-fast',
							resolve: async () => {
								await delay(5);

								return '<section>vue fast resolved</section>';
							}
						}),
						h(StreamSlot, {
							fallbackHtml: '<p>slow loading</p>',
							id: 'vue-slow',
							resolve: async () => {
								await delay(20);

								return '<section>vue slow resolved</section>';
							}
						})
					])
				])
			]);
	}
});

describe('handleVuePageRequest streaming', () => {
	test('captures SSR text before loading the Vue client module', async () => {
		const response = await handleVuePageRequest({
			indexPath: '/vue-translation-index.js',
			Page: defineComponent({
				setup: () => () => h('h1', 'AI Matching')
			}),
			pagePath: '/tests/translation.vue'
		});
		const html = await response.text();
		const baselineIndex = html.indexOf(
			'window.__ABSOLUTE_SSR_TEXT_BASELINES__=new WeakMap()'
		);
		const moduleIndex = html.indexOf(
			'<script type="module" src="/vue-translation-index.js">'
		);

		expect(html).toContain('<h1>AI Matching</h1>');
		expect(baselineIndex).toBeGreaterThan(-1);
		expect(moduleIndex).toBeGreaterThan(baselineIndex);
	});

	test('returns a 404 when an SPA router marks the request as unmatched', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'absolute-vue-404-'));
		const pagePath = join(directory, 'Portal.js');
		await writeFile(
			pagePath,
			`export default { render() { return null; } };
export const setupApp = async (_app, context) => context.setNotFound();`
		);

		try {
			const response = await handleVuePageRequest({
				client: 'none',
				pagePath,
				props: {},
				request: new Request('https://example.com/portal/missing')
			});

			expect(response.status).toBe(404);
			expect(await response.text()).toBe('Not found');
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	test('returns a 500 instead of committing a partial document when ordinary SSR fails asynchronously', async () => {
		const errorSpy = spyOn(console, 'error').mockImplementation(
			() => undefined
		);
		const FailingChild = defineAsyncComponent(async () => {
			await delay(1);

			return defineComponent({
				name: 'FailingChild',
				setup: () => () => {
					throw new Error('async Vue SSR failed');
				}
			});
		});
		const FailingPage = defineComponent({
			name: 'FailingPage',
			setup: () => () => h('main', [h(FailingChild)])
		});

		try {
			const response = await handleVuePageRequest({
				client: 'none',
				headTag: '<head><title>Failure</title></head>',
				Page: FailingPage,
				pagePath: '/tests/failing.vue'
			});
			const html = await response.text();

			expect(response.status).toBe(500);
			expect(html).toContain('SSR Error - AbsoluteJS');
			expect(html).toContain('async Vue SSR failed');
			expect(errorSpy).toHaveBeenCalled();
		} finally {
			errorSpy.mockRestore();
		}
	});

	test('injects runtime and appends patches for registered StreamSlot components', async () => {
		const response = await handleVuePageRequest({
			collectStreamingSlots: true,
			headTag: '<head><title>Vue Streaming Test</title></head>',
			indexPath: '/vue-test-index.js',
			Page: VueStreamingTestPage,
			pagePath: '/tests/inline.vue'
		});
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"vue-fast"');
		const slowPatchIndex = html.indexOf('"vue-slow"');

		expect(response.headers.get('Content-Type')).toBe('text/html');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="vue-fast"');
		expect(html).toContain('id="vue-slow"');
		expect(html).toContain('vue fast resolved');
		expect(html).toContain('vue slow resolved');
		expect(html).not.toContain(
			'window.__ABS_SLOT_HYDRATION_PENDING__=true'
		);
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});

	test('renders framework-level SuspenseSlot fallback and resolved slot content', async () => {
		const VueSuspenseTestPage = defineComponent({
			name: 'VueSuspenseTestPage',
			setup() {
				return () =>
					h('html', { lang: 'en' }, [
						h('head', [h('title', 'Vue Suspense Slot Test')]),
						h('body', [
							h('main', [
								h(
									SuspenseSlot,
									{
										id: 'vue-suspense',
										promise: resolveVueSuspenseValue()
									},
									{
										default: ({
											value
										}: {
											value: { label: string };
										}) =>
											h('section', [
												h('strong', value.label)
											]),
										fallback: () =>
											h('article', [
												h('p', 'vue suspense fallback')
											])
									}
								)
							])
						])
					]);
			}
		});
		const response = await handleVuePageRequest({
			collectStreamingSlots: true,
			headTag: '<head><title>Vue Suspense Slot Test</title></head>',
			indexPath: '/vue-suspense-test-index.js',
			Page: VueSuspenseTestPage,
			pagePath: '/tests/inline-suspense.vue'
		});
		const html = await response.text();

		expect(html).toContain('vue suspense fallback');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="vue-suspense"');
		expect(html).toContain('"kind":"vue-suspense"');
		expect(html).not.toContain(
			'window.__ABS_SLOT_HYDRATION_PENDING__=true'
		);
	});
});

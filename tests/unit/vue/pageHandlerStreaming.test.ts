import { describe, expect, test } from 'bun:test';
import { defineComponent, h } from 'vue';
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
	test('injects runtime and appends patches for registered StreamSlot components', async () => {
		const response = await handleVuePageRequest(
			VueStreamingTestPage,
			'/tests/inline.vue',
			'/vue-test-index.js',
			'<head><title>Vue Streaming Test</title></head>',
			undefined,
			{ collectStreamingSlots: true }
		);
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
		const response = await handleVuePageRequest(
			VueSuspenseTestPage,
			'/tests/inline-suspense.vue',
			'/vue-suspense-test-index.js',
			'<head><title>Vue Suspense Slot Test</title></head>',
			undefined,
			{ collectStreamingSlots: true }
		);
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

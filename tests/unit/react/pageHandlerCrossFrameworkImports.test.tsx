import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import {
	REACT_STREAM_SLOT_FAST_DELAY_MS,
	REACT_STREAM_SLOT_SLOW_DELAY_MS,
	UNFOUND_INDEX
} from '../../../src/constants';

const delay = async (milliseconds: number) => Bun.sleep(milliseconds);

describe('handleReactPageRequest across source framework imports', () => {
	test('keeps React slot registration working after other framework source entrypoints are imported', async () => {
		await import('../../../src/angular');
		await import('../../../src/svelte');
		await import('../../../src/vue');

		const { handleReactPageRequest } = await import('../../../src/react');
		const { StreamSlot } = await import('../../../src/react/components');

		const Page = () =>
			createElement(
				'html',
				{ lang: 'en' },
				createElement(
					'head',
					null,
					createElement(
						'title',
						null,
						'Source Cross-Framework Entrypoint Streaming Test'
					)
				),
				createElement(
					'body',
					null,
					createElement(
						'main',
						null,
						createElement(StreamSlot, {
							fallbackHtml: '<p>fast loading</p>',
							id: 'source-cross-fast',
							resolve: async () => {
								await delay(REACT_STREAM_SLOT_FAST_DELAY_MS);

								return '<section>source cross fast resolved</section>';
							}
						}),
						createElement(StreamSlot, {
							fallbackHtml: '<p>slow loading</p>',
							id: 'source-cross-slow',
							resolve: async () => {
								await delay(REACT_STREAM_SLOT_SLOW_DELAY_MS);

								return '<section>source cross slow resolved</section>';
							}
						})
					)
				)
			);

		const response = await handleReactPageRequest({
			Page,
			index: '/react-source-cross-framework-test-index.js',
			collectStreamingSlots: true
		});
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"source-cross-fast"');
		const slowPatchIndex = html.indexOf('"source-cross-slow"');

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="source-cross-fast"');
		expect(html).toContain('id="source-cross-slow"');
		expect(html).toContain('source cross fast resolved');
		expect(html).toContain('source cross slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(UNFOUND_INDEX);
		expect(slowPatchIndex).toBeGreaterThan(UNFOUND_INDEX);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});
});

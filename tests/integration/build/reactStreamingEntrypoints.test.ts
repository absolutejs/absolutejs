import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

describe('react streaming across built package entrypoints', () => {
	test('setup: build package dist once for built-entrypoint tests', async () => {
		await ensureDistBuild();
	}, 240_000);

	test('top-level handler and react/components StreamSlot share slot registration state', async () => {
		const { handleReactPageRequest } = await import(
			resolve(PROJECT_ROOT, 'dist/react/index.js')
		);
		const { StreamSlot } = await import(
			resolve(PROJECT_ROOT, 'dist/react/components/index.js')
		);

		const Page = () =>
			createElement(
				'html',
				{ lang: 'en' },
				createElement(
					'head',
					null,
					createElement('title', null, 'Built Entrypoint Streaming Test')
				),
				createElement(
					'body',
					null,
					createElement(
						'main',
						null,
						createElement(StreamSlot, {
							fallbackHtml: '<p>fast loading</p>',
							id: 'built-fast',
							resolve: async () => {
								await delay(5);

								return '<section>built fast resolved</section>';
							}
						}),
						createElement(StreamSlot, {
							fallbackHtml: '<p>slow loading</p>',
							id: 'built-slow',
							resolve: async () => {
								await delay(20);

								return '<section>built slow resolved</section>';
							}
						})
					)
				)
			);

		const response = await handleReactPageRequest({
			collectStreamingSlots: true,
			index: '/react-built-test-index.js',
			Page
		});
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"built-fast"');
		const slowPatchIndex = html.indexOf('"built-slow"');

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="built-fast"');
		expect(html).toContain('id="built-slow"');
		expect(html).toContain('built fast resolved');
		expect(html).toContain('built slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});
});

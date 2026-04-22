import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');

const delay = (ms: number) =>
	new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

describe('react streaming across cross-framework entrypoints', () => {
	test('setup: build package dist once for built-entrypoint tests', async () => {
		await ensureDistBuild();
	}, 240_000);

	test('keeps React slot registration working after other framework entrypoints are imported', async () => {
		await import(resolve(PROJECT_ROOT, 'dist/angular/index.js'));
		await import(resolve(PROJECT_ROOT, 'dist/svelte/index.js'));
		await import(resolve(PROJECT_ROOT, 'dist/vue/index.js'));

		const { handleReactPageRequest } = await import(
			resolve(PROJECT_ROOT, 'dist/index.js')
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
					createElement(
						'title',
						null,
						'Built Cross-Framework Entrypoint Streaming Test'
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
							id: 'cross-fast',
							resolve: async () => {
								await delay(5);

								return '<section>cross fast resolved</section>';
							}
						}),
						createElement(StreamSlot, {
							fallbackHtml: '<p>slow loading</p>',
							id: 'cross-slow',
							resolve: async () => {
								await delay(20);

								return '<section>cross slow resolved</section>';
							}
						})
					)
				)
			);

		const response = await handleReactPageRequest(
			Page,
			'/react-cross-framework-test-index.js',
			undefined,
			{ collectStreamingSlots: true }
		);
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"cross-fast"');
		const slowPatchIndex = html.indexOf('"cross-slow"');

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="cross-fast"');
		expect(html).toContain('id="cross-slow"');
		expect(html).toContain('cross fast resolved');
		expect(html).toContain('cross slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});
});

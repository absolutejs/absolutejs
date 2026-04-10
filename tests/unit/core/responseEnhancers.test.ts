import { describe, expect, test } from 'bun:test';
import {
	withRegisteredStreamingSlots,
	withStreamingSlots
} from '../../../src/core/responseEnhancers';
import {
	getStreamingSlotPolicy,
	setStreamingSlotPolicy
} from '../../../src/utils/streamingSlots';
import { registerStreamingSlot } from '../../../src/core/streamingSlotRegistrar';

describe('withStreamingSlots', () => {
	test('accepts a promised response and preserves response metadata', async () => {
		const responsePromise = Promise.resolve(
			new Response(
				'<!DOCTYPE html><html><head></head><body><div id="a">loading</div></body></html>',
				{
					headers: {
						'Content-Type': 'text/html',
						'X-Test': 'yes'
					},
					status: 202,
					statusText: 'Accepted'
				}
			)
		);
		const enhanced = await withStreamingSlots(responsePromise, {
			streamingSlots: [
				{
					id: 'a',
					resolve: async () => '<section>done</section>'
				}
			]
		});
		const html = await enhanced.text();

		expect(enhanced.status).toBe(202);
		expect(enhanced.statusText).toBe('Accepted');
		expect(enhanced.headers.get('X-Test')).toBe('yes');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('"a"');
	});

	test('collects registered slots during render and appends patches', async () => {
		const enhanced = await withRegisteredStreamingSlots(async () => {
			registerStreamingSlot({
				fallbackHtml: '<p>loading</p>',
				id: 'registered',
				resolve: async () => '<section>registered value</section>'
			});

			return new Response(
				'<!DOCTYPE html><html><head></head><body><div id="registered">loading</div></body></html>',
				{
					headers: { 'Content-Type': 'text/html' }
				}
			);
		});
		const html = await enhanced.text();

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('"registered"');
		expect(html).toContain('registered value');
	});

	test('uses global and per-call policy when enhancing a response', async () => {
		const previous = getStreamingSlotPolicy();
		try {
			setStreamingSlotPolicy({
				errorHtml: '<p>policy failed</p>',
				timeoutMs: 1
			});

			const enhanced = await withStreamingSlots(
				new Response(
					'<!DOCTYPE html><html><head></head><body><div id="policy">loading</div><div id="ignored">loading</div></body></html>',
					{
						headers: { 'Content-Type': 'text/html' }
					}
				),
				{
					policy: {
						maxSlotsPerResponse: 1
					},
					streamingSlots: [
						{
							id: 'policy',
							resolve: async () => {
								await Bun.sleep(20);

								return '<section>policy value</section>';
							}
						},
						{
							id: 'ignored',
							resolve: async () => {
								await Bun.sleep(20);

								return '<section>ignored value</section>';
							}
						}
					]
				}
			);
			const html = await enhanced.text();

			expect(html).toContain('id="policy"');
			expect(html).toContain('id="ignored"');
			expect(html).toContain('policy failed');
			expect(html).not.toContain('__ABS_SLOT_ENQUEUE__("ignored"');
		} finally {
			setStreamingSlotPolicy(previous);
		}
	});
});

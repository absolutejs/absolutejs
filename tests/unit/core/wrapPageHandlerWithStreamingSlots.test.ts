import { describe, expect, test } from 'bun:test';
import { registerStreamingSlot } from '../../../src/core/streamingSlotRegistrar';
import { wrapPageHandlerWithStreamingSlots } from '../../../src/core/wrapPageHandlerWithStreamingSlots';

describe('wrapPageHandlerWithStreamingSlots', () => {
	test('auto-applies registered streaming slots to handler responses', async () => {
		const wrapped = wrapPageHandlerWithStreamingSlots(async () => {
			registerStreamingSlot({
				id: 'wrapped-slot',
				resolve: async () => '<section>wrapped value</section>'
			});

			return new Response(
				'<!DOCTYPE html><html><head></head><body><div id="wrapped-slot">loading</div></body></html>',
				{ headers: { 'Content-Type': 'text/html' } }
			);
		});

		const response = await wrapped();
		const html = await response.text();

		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('"wrapped-slot"');
		expect(html).toContain('wrapped value');
	});
});

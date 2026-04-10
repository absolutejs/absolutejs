import { afterEach, describe, expect, test } from 'bun:test';
import {
	injectIslandPageContextStream,
	setCurrentIslandManifest
} from '../../../src/core/islandPageContext';

const createStream = (chunks: string[]) => {
	const encoder = new TextEncoder();

	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		}
	});
};

afterEach(() => {
	globalThis.__absoluteManifest = undefined;
	globalThis.__ABS_ISLAND_STATE__ = undefined;
});

describe('injectIslandPageContextStream', () => {
	test('injects into head when hasIslands is true', async () => {
		setCurrentIslandManifest({
			BootstrapClient: '/client/islands.js'
		});
		const stream = createStream([
			'<!DOCTYPE html><html><head><title>Page</title></head><body>',
			'<div>content</div></body></html>'
		]);
		const injected = injectIslandPageContextStream(stream, {
			hasIslands: true
		});
		const html = await new Response(injected).text();

		expect(html).toContain('window.__ABSOLUTE_MANIFEST__');
		expect(html).toContain('window.__ABS_ISLAND_STATE__');
		expect(html).toContain(
			'<script type="module" src="/client/islands.js">'
		);
		expect(html).toContain('<title>Page</title>');
	});

	test('auto-detect mode injects before first island tag', async () => {
		setCurrentIslandManifest({
			BootstrapClient: '/client/islands.js'
		});
		const stream = createStream([
			'<!DOCTYPE html><html><head></head><body><div>before</div>',
			'<absolute-island framework="react" data-island="true"></absolute-island>',
			'</body></html>'
		]);
		const injected = injectIslandPageContextStream(stream);
		const html = await new Response(injected).text();
		const scriptIndex = html.indexOf('window.__ABSOLUTE_MANIFEST__');
		const islandIndex = html.indexOf('<absolute-island');

		expect(scriptIndex).toBeGreaterThan(-1);
		expect(islandIndex).toBeGreaterThan(-1);
		expect(scriptIndex).toBeLessThan(islandIndex);
	});

	test('returns unchanged stream when hasIslands is false', async () => {
		setCurrentIslandManifest({
			BootstrapClient: '/client/islands.js'
		});
		const original =
			'<!DOCTYPE html><html><head></head><body><p>plain</p></body></html>';
		const stream = createStream([original]);
		const injected = injectIslandPageContextStream(stream, {
			hasIslands: false
		});
		const html = await new Response(injected).text();

		expect(html).toBe(original);
	});
});

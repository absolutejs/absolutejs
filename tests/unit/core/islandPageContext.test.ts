import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
	injectIslandPageContext,
	injectIslandPageContextStream,
	resetIslandBootstrapWarning,
	setCurrentIslandManifest
} from '../../../src/core/islandPageContext';
import * as logger from '../../../src/utils/logger';

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

const ISLAND_PAGE =
	'<!DOCTYPE html><html><head></head><body><div data-island="true" data-framework="react" data-component="A"></div></body></html>';

describe('islands bootstrap injection', () => {
	afterEach(() => {
		resetIslandBootstrapWarning();
	});

	test('injects the bootstrap under the reserved key, whatever its file name', () => {
		setCurrentIslandManifest({
			AbsoluteIslandBootstrap: '/src/islands/startMyIslands.abc.js',
			StartMyIslands: '/src/islands/startMyIslands.abc.js'
		});

		expect(injectIslandPageContext(ISLAND_PAGE)).toContain(
			'<script type="module" src="/src/islands/startMyIslands.abc.js"></script>'
		);
	});

	test('still honors a manifest that only has the legacy BootstrapClient key', () => {
		setCurrentIslandManifest({ BootstrapClient: '/islands/legacy.js' });

		expect(injectIslandPageContext(ISLAND_PAGE)).toContain(
			'<script type="module" src="/islands/legacy.js"></script>'
		);
	});

	test('warns once when a page has islands but no bootstrap', async () => {
		const warn = spyOn(logger, 'logWarn').mockImplementation(() => {});
		try {
			setCurrentIslandManifest({ IslandReactA: '/islands/react/A.js' });
			const html = injectIslandPageContext(ISLAND_PAGE);
			injectIslandPageContext(ISLAND_PAGE);
			await new Response(
				injectIslandPageContextStream(createStream([ISLAND_PAGE]))
			).text();

			expect(html).not.toContain('type="module"');
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0]?.[0]).toContain('islands bootstrap');
		} finally {
			warn.mockRestore();
		}
	});

	test('does not warn for pages without islands', () => {
		const warn = spyOn(logger, 'logWarn').mockImplementation(() => {});
		try {
			setCurrentIslandManifest({ IslandReactA: '/islands/react/A.js' });
			injectIslandPageContext(
				'<html><head></head><body>plain</body></html>'
			);

			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});

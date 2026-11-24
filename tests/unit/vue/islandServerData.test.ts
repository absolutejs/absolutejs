import { afterEach, describe, expect, test } from 'bun:test';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import {
	injectIslandPageContext,
	setCurrentIslandManifest
} from '../../../src/core/islandPageContext';
import { renderIslandMarkup } from '../../../src/core/renderIslandMarkup';
import {
	getVueIslandServerData,
	peekVueIslandServerData,
	runWithAbsoluteRequest
} from '../../../src/core/requestContext';
import {
	createServerDataCollector,
	SERVER_DATA_CONTEXT_KEY,
	serializeServerDataScript
} from '../../../src/vue/serverDataPayload';
import { useServerData } from '../../../src/vue/useServerData';

/* `useServerData` reads its collector off Vue's SSR context, and only the
 * Vue PAGE handler ever created one. An island on a React, Svelte or HTML
 * page therefore rendered its pending state and the browser fetched the
 * data after hydration — a loading flash and a round trip for data the
 * server already had in hand.
 *
 * The browser build reads exactly one place, `window.__ABSOLUTE_SERVER_DATA__`,
 * which is why the island payload goes to the same global a Vue page
 * writes rather than inventing a second channel. */

const Island = defineComponent({
	setup() {
		const { data, pending } = useServerData('probe', async () => ({
			name: 'from server'
		}));

		return () =>
			h('p', pending.value ? 'pending' : (data.value?.name ?? 'none'));
	}
});

const renderIsland = (ssrContext?: Record<string, unknown>) =>
	renderToString(createSSRApp({ render: () => h(Island) }), ssrContext);

afterEach(() => {
	globalThis.__absoluteManifest = undefined;
});

describe('a Vue island outside a Vue page', () => {
	test('renders its data when a collector is on the context', async () => {
		const collector = createServerDataCollector();
		const html = await renderIsland({
			[SERVER_DATA_CONTEXT_KEY]: collector
		});

		expect(html).toContain('from server');
		expect(serializeServerDataScript(collector)).toContain('from server');
	});

	/* The old behaviour, kept reachable and documented: with no collector
	 * the hook leaves its state pending so the server markup matches what
	 * the browser starts with. */
	test('renders pending when there is no collector', async () => {
		expect(await renderIsland()).toContain('pending');
	});

	test('the payload is keyed the way a page keys its own', async () => {
		const collector = createServerDataCollector();
		await renderIsland({ [SERVER_DATA_CONTEXT_KEY]: collector });

		expect(serializeServerDataScript(collector)).toContain(
			'window.__ABSOLUTE_SERVER_DATA__'
		);
		expect(serializeServerDataScript(collector)).toContain('"probe"');
	});
});

describe('the request-scoped collector', () => {
	test('is created once and shared by every island on the page', async () => {
		await runWithAbsoluteRequest(new Request('https://x.test/'), () => {
			const first = getVueIslandServerData(createServerDataCollector);
			const second = getVueIslandServerData(createServerDataCollector);

			expect(first).toBe(second);
		});
	});

	/* The page context asks on every page, and a page with no Vue islands
	 * should not grow a collector for the asking. */
	test('peeking does not create one', async () => {
		await runWithAbsoluteRequest(new Request('https://x.test/'), () => {
			expect(peekVueIslandServerData()).toBeUndefined();
		});
	});

	test('outside a request there is nothing to collect into', () => {
		expect(
			getVueIslandServerData(createServerDataCollector)
		).toBeUndefined();
	});
});

describe('the page context', () => {
	test('carries the island payload into the document', async () => {
		setCurrentIslandManifest({ BootstrapClient: '/client/islands.js' });
		const html = await runWithAbsoluteRequest(
			new Request('https://x.test/'),
			async () => {
				const collector = getVueIslandServerData(
					createServerDataCollector
				);

				await renderIsland({ [SERVER_DATA_CONTEXT_KEY]: collector });

				return injectIslandPageContext(
					'<!DOCTYPE html><html><head></head><body></body></html>',
					{ hasIslands: true }
				);
			}
		);

		expect(html).toContain('window.__ABSOLUTE_SERVER_DATA__');
		expect(html).toContain('from server');
	});

	/* A page with no Vue islands gains nothing: the script is only
	 * written when something collected into it. */
	test('writes nothing when no island collected data', async () => {
		setCurrentIslandManifest({ BootstrapClient: '/client/islands.js' });
		const html = await runWithAbsoluteRequest(
			new Request('https://x.test/'),
			() =>
				injectIslandPageContext(
					'<!DOCTYPE html><html><head></head><body></body></html>',
					{ hasIslands: true }
				)
		);

		expect(html).not.toContain('__ABSOLUTE_SERVER_DATA__');
	});
});

describe('through the island renderer itself', () => {
	/* The test above renders the component directly, which proves the
	 * plumbing but not that `renderIslandMarkup` supplies the context. */
	test('a Vue island rendered as an island gets its data', async () => {
		const html = await runWithAbsoluteRequest(
			new Request('https://x.test/'),
			() =>
				renderIslandMarkup(
					{ vue: { Probe: Island } },
					{ component: 'Probe', framework: 'vue', props: {} }
				)
		);

		expect(html).toContain('from server');
		expect(html).not.toContain('pending');
	});

	/* Outside a request there is no collector to create, and the island
	 * keeps today's behaviour rather than throwing. */
	test('outside a request it still renders, pending', async () => {
		const html = await renderIslandMarkup(
			{ vue: { Probe: Island } },
			{ component: 'Probe', framework: 'vue', props: {} }
		);

		expect(html).toContain('pending');
	});
});

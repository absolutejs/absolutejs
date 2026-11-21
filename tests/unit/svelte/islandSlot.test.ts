import { afterAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const nativeFetch = globalThis.fetch;
const nativeRequest = globalThis.Request;
const nativeResponse = globalThis.Response;
const nativeHeaders = globalThis.Headers;

GlobalRegistrator.register();

globalThis.fetch = nativeFetch;
globalThis.Request = nativeRequest;
globalThis.Response = nativeResponse;
globalThis.Headers = nativeHeaders;

afterAll(() => GlobalRegistrator.unregister());

import { absoluteIslandSlot } from '../../../src/svelte/resolveIslandHtml.browser';

/* The rule the Svelte island slot follows on the client: fill the slot
 * only when it is empty.
 *
 * The browser half — that a hydrating page leaves a live island alone, and
 * mounts it exactly once — is
 * `tests/integration/build/svelte-page-with-island-browser`. This covers
 * the decision itself, including the mounting case that no web page
 * handler can reach: a client render comes from the mobile shell
 * (`src/mobile/client.ts` sets `__ABSOLUTE_PAGE_RENDER_MODE__`), and an
 * HMR remount from the dev client. */

const slot = (html: string) => {
	const node = document.createElement('div');
	node.innerHTML = html;

	return node;
};

const ISLAND = '<div data-island="true" data-component="X">rendered</div>';

describe('absoluteIslandSlot', () => {
	test('fills an empty slot, which is every mounting render', () => {
		const node = slot('');
		absoluteIslandSlot(node, () => ISLAND);

		expect(node.querySelectorAll('[data-island]').length).toBe(1);
	});

	test('leaves a slot that already holds an island alone', () => {
		/* The island in a hydrating page's slot may already be a LIVE
		 * instance, hydrated by the islands bootstrap before the page got
		 * here. Replacing its markup is what left two instances and two
		 * disposers for one element, the first of them running on detached
		 * nodes. */
		const node = slot(ISLAND);
		const before = node.firstElementChild;
		let resolved = 0;
		absoluteIslandSlot(node, () => {
			resolved += 1;

			return ISLAND;
		});

		// The same node object, not an identical-looking replacement.
		expect(node.firstElementChild).toBe(before);
		expect(node.querySelectorAll('[data-island]').length).toBe(1);
		// And the markup was never even asked for.
		expect(resolved).toBe(0);
	});

	test('fills a slot holding markup that is not an island', () => {
		/* Whitespace, a comment, a Svelte anchor: the question is whether
		 * an ISLAND is there, not whether the node has children. */
		const node = slot('<!-- anchor --> ');
		absoluteIslandSlot(node, () => ISLAND);

		expect(node.querySelectorAll('[data-island]').length).toBe(1);
	});
});

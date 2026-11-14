import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { claimServerIslandStyleLink } from '../../../src/client/preserveIslandMarkup';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const island = {
	component: 'Counter',
	framework: 'svelte',
	props: { start: 1 }
} as const;

const marker = `<div data-component="Counter" data-framework="svelte" data-hydrate="load" data-island="true" data-props="{&quot;start&quot;:1}"></div>`;

describe('a hydrating Vue Island finds the link the server streamed before it', () => {
	test('each instance takes the next server island, in document order', () => {
		document.body.innerHTML = `<main><section><!--[--><link rel="stylesheet" href="/islands/svelte/Counter.abc.css" data-island-style="IslandStyleSvelteCounter">${marker}<!--]--></section>${marker}</main>`;

		expect(claimServerIslandStyleLink(island)).toEqual({
			href: '/islands/svelte/Counter.abc.css',
			key: 'IslandStyleSvelteCounter'
		});
		// Same signature, rendered second: the server linked it once.
		expect(claimServerIslandStyleLink(island)).toBeNull();
		// A browser-only render has no server island left to take.
		expect(claimServerIslandStyleLink(island)).toBeNull();
	});

	test('an island rendered without a link has none', () => {
		document.body.innerHTML = `<main><link rel="stylesheet" href="/app.css">${marker}</main>`;

		expect(claimServerIslandStyleLink(island)).toBeNull();
	});
});

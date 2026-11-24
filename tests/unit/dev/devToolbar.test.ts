import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
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

import {
	installDevToolbar,
	islandFacts
} from '../../../src/dev/client/devToolbar';

/* `docs/dev/absolute-studio.md` (now dev-toolbar.md) described a
 * dashboard at its own route,
 * in the present tense, with five panels. None of its surface existed, so
 * a reader following the doc got a 404.
 *
 * It is a toolbar rather than a route because the valuable half needs the
 * page: which islands are on it, of which frameworks, with which hydrate
 * strategies. A separate document can see none of that. */

const HOST = '#absolute-dev-toolbar';

const island = (attributes: Record<string, string>) => {
	const element = document.createElement('div');
	element.setAttribute('data-island', 'true');
	for (const [name, value] of Object.entries(attributes))
		element.setAttribute(name, value);
	document.body.append(element);
};

beforeEach(() => {
	document.querySelector(HOST)?.remove();
	document.body.innerHTML = '';
});

describe('reading the page', () => {
	/* Nothing new is instrumented for this: every island already carries
	 * these attributes in the markup both the server and client produce
	 * (core/islandMarkupAttributes.ts). */
	test('an island reports its component, framework and hydrate strategy', () => {
		island({
			'data-component': 'Counter',
			'data-framework': 'svelte',
			'data-hydrate': 'visible'
		});

		expect(islandFacts(document)).toEqual([
			{
				component: 'Counter',
				framework: 'svelte',
				hydrate: 'visible',
				persist: undefined
			}
		]);
	});

	test('a persisted island reports its key', () => {
		island({
			'data-absolute-persist': 'cart',
			'data-component': 'Cart',
			'data-framework': 'vue',
			'data-hydrate': 'load'
		});

		expect(islandFacts(document)[0]?.persist).toBe('cart');
	});

	/* The point of the panel: two frameworks on one page is the thing no
	 * other devtools can show, because React's sees React and Vue's sees
	 * Vue. */
	test('islands of different frameworks on one page', () => {
		island({ 'data-component': 'A', 'data-framework': 'react' });
		island({ 'data-component': 'B', 'data-framework': 'svelte' });

		expect(islandFacts(document).map((one) => one.framework)).toEqual([
			'react',
			'svelte'
		]);
	});

	test('a page with no islands reports none', () => {
		document.body.innerHTML = '<p>no islands here</p>';

		expect(islandFacts(document)).toEqual([]);
	});

	/* `hydrate` defaults to `load` in the markup helper, so a missing
	 * attribute is reported as that rather than as unknown. */
	test('a missing hydrate attribute reads as load', () => {
		island({ 'data-component': 'C', 'data-framework': 'html' });

		expect(islandFacts(document)[0]?.hydrate).toBe('load');
	});
});

describe('mounting', () => {
	test('mounts outside the body', () => {
		installDevToolbar();
		const host = document.querySelector(HOST);

		expect(host).not.toBeNull();
		expect(host?.parentElement?.tagName).toBe('HTML');
	});

	/* A soft navigation REPLACES document.body (client/navigation.ts), so
	 * a toolbar mounted inside it disappears on the first navigation. */
	test('survives the body being replaced', () => {
		installDevToolbar();
		document.body.replaceWith(document.createElement('body'));

		expect(document.querySelector(HOST)).not.toBeNull();
	});

	/* A soft navigation also re-runs the incoming page's module entries
	 * under a fresh URL, so this install runs again on every visit. Each
	 * one adding another keydown handler and another HMR subscription is
	 * the accumulation that made an island mount once per visit SQUARED
	 * (client/islandHydrationState.ts). */
	test('installing again adds neither a second host nor a second shadow root', () => {
		installDevToolbar();
		const first = document.querySelector(HOST)?.shadowRoot;
		installDevToolbar();
		installDevToolbar();

		expect(document.querySelectorAll(HOST)).toHaveLength(1);
		expect(document.querySelector(HOST)?.shadowRoot).toBe(first);
	});

	/* Its styles must not reach the page and the page's must not reach
	 * it: a dev tool that restyles the app it is inspecting is worse than
	 * no dev tool. */
	test('renders inside a shadow root', () => {
		installDevToolbar();

		expect(document.querySelector(HOST)?.shadowRoot).not.toBeNull();
	});

	/* A link inside the toolbar must never be taken for a page
	 * navigation. */
	test('opts out of the navigation layer', () => {
		installDevToolbar();

		expect(
			document
				.querySelector(HOST)
				?.getAttribute('data-absolute-navigation')
		).toBe('off');
	});
});

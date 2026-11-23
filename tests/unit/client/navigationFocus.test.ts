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

import { announcePage, resetFocus } from '../../../src/client/navigationFocus';

/* What a full page load gives for free and a soft navigation does not:
 * focus lands in the new document, and a screen reader reads it. Without
 * both, a keyboard user is left on a link that no longer exists and a
 * screen reader user is told nothing happened. */

const ANNOUNCER = '#absolute-navigation-announcer';

const page = (body: string) => {
	document.body.innerHTML = body;
};

const announcer = () => document.querySelector(ANNOUNCER);

beforeEach(() => {
	document.body.innerHTML = '';
	document.title = '';
});

describe('where focus goes', () => {
	/* The heading, because it does both jobs at once: it moves focus past
	 * the navigation a keyboard user would otherwise tab through again,
	 * and it names the page a screen reader user just arrived at. */
	test('the new page’s heading', () => {
		page(
			'<nav><a href="/x">x</a></nav><main><h1>Pricing</h1><p>…</p></main>'
		);
		const moved = resetFocus();

		expect(moved).toBe(true);
		expect(document.activeElement?.textContent).toBe('Pricing');
	});

	test('the main landmark when there is no heading', () => {
		page('<nav><a href="/x">x</a></nav><main id="content"><p>…</p></main>');
		resetFocus();

		expect((document.activeElement as HTMLElement).id).toBe('content');
	});

	/* A page that asked for something specific gets it. */
	test('an explicit autofocus wins', () => {
		page('<main><h1>Search</h1><input autofocus id="q" /></main>');
		resetFocus();

		expect((document.activeElement as HTMLElement).id).toBe('q');
	});

	/* A heading is not focusable on its own, so it is made focusable —
	 * but with -1, which keeps it out of the tab sequence. A heading that
	 * became a tab stop would add a stop to every page. */
	test('the heading is focusable but not tabbable', () => {
		page('<main><h1>Pricing</h1></main>');
		resetFocus();

		expect(document.querySelector('h1')?.getAttribute('tabindex')).toBe(
			'-1'
		);
	});

	/* And the attribute does not outlive the focus, so the app's own
	 * `[tabindex]` styling and queries see the page they wrote. */
	test('the tabindex is removed once focus leaves', () => {
		page('<main><h1>Pricing</h1><a href="/y" id="next">next</a></main>');
		resetFocus();
		document.querySelector<HTMLElement>('#next')?.focus();

		expect(document.querySelector('h1')?.hasAttribute('tabindex')).toBe(
			false
		);
	});

	/* A heading the page already made focusable keeps whatever it had. */
	test('an existing tabindex is left alone', () => {
		page('<main><h1 tabindex="0">Pricing</h1></main>');
		resetFocus();
		document.body.focus();

		expect(document.querySelector('h1')?.getAttribute('tabindex')).toBe(
			'0'
		);
	});

	/* Nothing to focus is still better than leaving focus on an element
	 * from the page that was just replaced. */
	test('with nothing to focus, focus leaves the old element', () => {
		page('<div><a href="/x" id="old">x</a></div>');
		document.querySelector<HTMLElement>('#old')?.focus();
		const moved = resetFocus();

		expect(moved).toBe(false);
		expect(document.activeElement).not.toBe(document.querySelector('#old'));
	});
});

describe('what is announced', () => {
	/* The defect this half fixes. The region carried `role="status"`,
	 * whose implicit live setting is POLITE, together with an explicit
	 * `aria-live="assertive"` — a contradiction each screen reader
	 * resolves its own way. The explicit attribute says what was meant, so
	 * the role is what goes. */
	test('the live region declares one politeness, not two', () => {
		page('<div></div>');
		announcePage(false);
		const region = announcer();

		expect(region?.getAttribute('aria-live')).toBe('assertive');
		expect(region?.hasAttribute('role')).toBe(false);
		expect(region?.getAttribute('aria-atomic')).toBe('true');
	});

	test('it announces the title, falling back to the heading', () => {
		document.title = 'Pricing — Acme';
		page('<div></div>');
		announcePage(false);

		expect(announcer()?.textContent).toBe('Pricing — Acme');

		document.title = '';
		page('<h1>Just a heading</h1>');
		announcePage(false);

		expect(announcer()?.textContent).toBe('Just a heading');
	});

	/* Focusing the heading already makes a screen reader read it.
	 * Announcing as well says the same thing twice, so the live region is
	 * the fallback for a page with nothing to focus rather than a second
	 * channel. */
	test('nothing is announced when focus moved into the content', () => {
		document.title = 'Pricing';
		page('<main><h1>Pricing</h1></main>');
		announcePage(true);

		expect(announcer()).toBeNull();
	});

	test('one region is reused across navigations', () => {
		page('<div></div>');
		announcePage(false);
		announcePage(false);

		expect(document.querySelectorAll(ANNOUNCER).length).toBe(1);
	});
});

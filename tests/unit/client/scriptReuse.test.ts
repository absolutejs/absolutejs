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
	keepRunningScripts,
	liveScriptsByIdentity,
	reusableScript
} from '../../../src/client/scriptReuse';

/* The navigation layer recreates every executable script of the page it
 * swaps in, so a third-party tag two pages share ran again on each one.
 * Measured in a browser before this existed: one tag on two pages, its
 * counter read 1, then 2 after a soft navigation, then 3 after going
 * back. */

const incoming = (markup: string) => {
	const parsed = new DOMParser().parseFromString(
		`<html><head>${markup}</head><body></body></html>`,
		'text/html'
	);
	const script = parsed.querySelector('script');
	if (script === null) throw new Error('fixture has no script');

	return script;
};

beforeEach(() => {
	document.head.innerHTML = '';
});

describe('what the live document is already running', () => {
	test('indexed by identity', () => {
		document.head.innerHTML =
			'<script data-absolute-script="/a.js" src="/a.js"></script>';

		expect([...liveScriptsByIdentity(document).keys()]).toEqual(['/a.js']);
	});

	/* A page's own hydration index has the same `src` on both sides of a
	 * navigation and MUST run again — that is how the incoming page
	 * mounts. Only a marked script is a candidate. */
	test('an unmarked script is not a candidate', () => {
		document.head.innerHTML = '<script src="/react-index.js"></script>';

		expect(liveScriptsByIdentity(document).size).toBe(0);
	});

	test('an empty marker is not an identity', () => {
		document.head.innerHTML =
			'<script data-absolute-script="" src="/a.js"></script>';

		expect(liveScriptsByIdentity(document).size).toBe(0);
	});
});

describe('deciding whether an incoming script runs', () => {
	test('one the document already runs is reused, not run', () => {
		document.head.innerHTML =
			'<script data-absolute-script="analytics" src="/a.js"></script>';
		const live = liveScriptsByIdentity(document);
		const running = live.get('analytics');

		expect(
			reusableScript(
				live,
				incoming(
					'<script data-absolute-script="analytics" src="/a.js"></script>'
				)
			)
		).toBe(running);
	});

	/* Identity, not src: the same tag served from a different path on the
	 * next page is still that tag, and a project that versions its own
	 * script URL should not get two copies of it. */
	test('identity is what matches, not the url', () => {
		document.head.innerHTML =
			'<script data-absolute-script="analytics" src="/a.v1.js"></script>';
		const live = liveScriptsByIdentity(document);

		expect(
			reusableScript(
				live,
				incoming(
					'<script data-absolute-script="analytics" src="/a.v2.js"></script>'
				)
			)
		).not.toBeUndefined();
	});

	test('one the document does not have has to run', () => {
		const live = liveScriptsByIdentity(document);

		expect(
			reusableScript(
				live,
				incoming(
					'<script data-absolute-script="chat" src="/c.js"></script>'
				)
			)
		).toBeUndefined();
	});

	test('an unmarked incoming script always runs', () => {
		document.head.innerHTML =
			'<script data-absolute-script="/a.js" src="/a.js"></script>';
		const live = liveScriptsByIdentity(document);

		expect(
			reusableScript(live, incoming('<script src="/a.js"></script>'))
		).toBeUndefined();
	});

	/* Two tags with one identity cannot both claim the same element: the
	 * second would move the node out from under the first. */
	test('the live element is claimed once', () => {
		document.head.innerHTML =
			'<script data-absolute-script="analytics" src="/a.js"></script>';
		const live = liveScriptsByIdentity(document);
		const source =
			'<script data-absolute-script="analytics" src="/a.js"></script>';

		expect(reusableScript(live, incoming(source))).not.toBeUndefined();
		expect(reusableScript(live, incoming(source))).toBeUndefined();
	});

	/* The element is MOVED rather than recreated because the browser's
	 * "already started" flag lives on the element: a fresh node with the
	 * same attributes would fetch and execute again. */
	test('reuse moves the running element into the new document', () => {
		document.head.innerHTML =
			'<script data-absolute-script="analytics" src="/a.js"></script>';
		const live = liveScriptsByIdentity(document);
		const running = reusableScript(
			live,
			incoming(
				'<script data-absolute-script="analytics" src="/a.js"></script>'
			)
		);
		const placeholder = document.createComment('here');
		document.head.append(placeholder);
		if (running === undefined)
			throw new Error('expected a reusable script');
		placeholder.replaceWith(running);

		expect(
			document.querySelectorAll('script[data-absolute-script]').length
		).toBe(1);
	});
});

describe('keeping what is already running', () => {
	/* The incoming page does not carry the tag — a `lazyOnload` script is
	 * never in a page's markup, and a page simply may not render one the
	 * last page did. The head swap discards the live node, so without this
	 * the record is lost and the script is added again. */
	test('a script the incoming page lacks is put back', () => {
		document.head.innerHTML =
			'<script data-absolute-script="analytics" src="/a.js"></script>';
		const live = liveScriptsByIdentity(document);
		document.head.innerHTML = '';
		keepRunningScripts(live, []);

		expect(
			document.querySelectorAll('script[data-absolute-script]').length
		).toBe(1);
		expect(live.size).toBe(0);
	});

	/* One the incoming page DOES carry stays in the map, for `runScript` to
	 * put in that tag's place. Appending it here as well would leave two
	 * copies of the element in the document. */
	test('a script the incoming page carries is left for reuse', () => {
		document.head.innerHTML =
			'<script data-absolute-script="analytics" src="/a.js"></script>';
		const live = liveScriptsByIdentity(document);
		document.head.innerHTML = '';
		keepRunningScripts(live, [
			incoming(
				'<script data-absolute-script="analytics" src="/a.js"></script>'
			)
		]);

		expect(document.head.children.length).toBe(0);
		expect(live.size).toBe(1);
	});

	test('an unmarked incoming script claims nothing', () => {
		document.head.innerHTML =
			'<script data-absolute-script="analytics" src="/a.js"></script>';
		const live = liveScriptsByIdentity(document);
		document.head.innerHTML = '';
		keepRunningScripts(live, [incoming('<script src="/a.js"></script>')]);

		expect(
			document.querySelectorAll('script[data-absolute-script]').length
		).toBe(1);
	});
});

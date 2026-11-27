import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { invalidate } from '../../../src/client/invalidate';
import {
	readPageUpdate,
	refreshInPlace
} from '../../../src/client/refreshInPlace';

/* Refreshing a page in place: when it may be done, and — most of this
 * file — when it must not be. Handing a mounted page props that were
 * meant for another page is wrong in a way nobody would see, so every
 * doubtful case has to be declined and left to the whole-page refresh.
 *
 * What the browser does with a real page is the browser test's subject
 * (tests/integration/build/invalidate-browser.test.ts); here the page,
 * the document and the server are stand-ins. */

const ROUTE_DATA = 'application/vnd.absolute.route+json';
const INDEX = '/react/indexes/TodosIndex.abc123.js';
const NAVIGATION_RUNTIME = Symbol.for('absolutejs.navigation');
const originalFetch = globalThis.fetch;
const originals = new Map<string, unknown>(
	['window', 'document'].map((name) => [name, Reflect.get(globalThis, name)])
);

type Applied = { props: Record<string, unknown>[] };

const applied: Applied = { props: [] };
const events: string[] = [];

type Listener = (event: Event) => void;

type FakePage = {
	__ABSOLUTE_PAGE_UPDATE__: (props: Record<string, unknown>) => boolean;
	addEventListener: (name: string, listener: Listener) => void;
	dispatchEvent: (event: Event) => boolean;
	location: { href: string; reload: () => void };
};

/* A window with an address and events, and a document with one script:
 * the page's client entry.
 *
 * Its events are a plain registry, not a real `EventTarget`: another
 * test file in this process may have installed a DOM library, and the
 * `CustomEvent` the code under test then creates is that library's,
 * which the runtime's own `EventTarget` refuses. */
const installPage = (scriptSrc = `http://localhost${INDEX}`) => {
	const listeners = new Map<string, Listener[]>();
	const page: FakePage = {
		location: { href: 'http://localhost/todos', reload: () => undefined },
		__ABSOLUTE_PAGE_UPDATE__: (props) => {
			applied.props.push(props);

			return true;
		},
		addEventListener: (name, listener) => {
			listeners.set(name, [...(listeners.get(name) ?? []), listener]);
		},
		dispatchEvent: (event) => {
			(listeners.get(event.type) ?? []).forEach((listener) =>
				listener(event)
			);

			return !event.defaultPrevented;
		}
	};
	['absolute:before-navigate', 'absolute:after-navigate'].forEach((name) =>
		page.addEventListener(name, () => events.push(name))
	);
	Reflect.set(globalThis, 'window', page);
	Reflect.set(globalThis, 'document', {
		scripts: [{ src: scriptSrc }],
		title: 'before'
	});

	return page;
};

type Answer = {
	body?: unknown;
	contentType?: string;
	redirected?: boolean;
	status?: number;
};

const envelope = (props: Record<string, unknown>, index = INDEX) => ({
	assets: { css: [], index },
	kind: 'route',
	props
});

const answerWith = ({
	body = envelope({ todos: ['new'] }),
	contentType = ROUTE_DATA,
	redirected = false,
	status = 200
}: Answer = {}) => {
	const requests: RequestInit[] = [];
	const stub = (_input: unknown, init?: RequestInit) => {
		requests.push(init ?? {});
		const response = new Response(JSON.stringify(body), {
			headers: { 'content-type': contentType },
			status
		});
		Object.defineProperty(response, 'redirected', { value: redirected });

		return Promise.resolve(response);
	};
	globalThis.fetch = Object.assign(stub, {
		preconnect: originalFetch.preconnect
	});

	return requests;
};

const run = () => {
	const update = readPageUpdate();
	if (!update) throw new Error('the page registered no update');

	return refreshInPlace(update);
};

beforeEach(() => {
	applied.props = [];
	events.length = 0;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	Reflect.deleteProperty(globalThis, NAVIGATION_RUNTIME);
	originals.forEach((value, name) => {
		if (value === undefined) Reflect.deleteProperty(globalThis, name);
		else Reflect.set(globalThis, name, value);
	});
});

describe('a page refreshed in place', () => {
	test('is given the props the route would render with now', async () => {
		installPage();
		answerWith({ body: envelope({ todos: ['a', 'b'] }) });

		expect(await run()).toBe('updated');
		expect(applied.props).toEqual([{ todos: ['a', 'b'] }]);
	});

	/* The data changed, which is why it is being asked for: nothing
	 * fetched before that may answer. */
	test('asks for data, past the HTTP cache, with the visitor’s cookies', async () => {
		installPage();
		const requests = answerWith();

		await run();

		expect(requests).toHaveLength(1);
		expect(requests[0]?.cache).toBe('reload');
		expect(requests[0]?.credentials).toBe('same-origin');
		expect(new Headers(requests[0]?.headers).get('accept')).toBe(
			ROUTE_DATA
		);
	});

	test('announces itself like any refresh', async () => {
		installPage();
		answerWith();

		await run();

		expect(events).toEqual([
			'absolute:before-navigate',
			'absolute:after-navigate'
		]);
	});

	test('takes the page’s new title when the data carries one', async () => {
		installPage();
		answerWith({
			body: { ...envelope({}), head: { title: 'Todos (3)' } }
		});

		await run();

		expect(Reflect.get(Reflect.get(globalThis, 'document'), 'title')).toBe(
			'Todos (3)'
		);
	});

	test('matches the page’s client entry whatever its query string', async () => {
		// A dev server appends a version to the script's address.
		installPage(`http://localhost${INDEX}?v=42`);
		answerWith();

		expect(await run()).toBe('updated');
	});
});

/* A Svelte page imports its client entry from an inline script, so
 * there is no `<script src>` to recognise it by. The entry says which
 * one it is when it registers its update. */
describe('a page whose client entry is not a script on the page', () => {
	const installScriptless = (declared: string) => {
		const page = installPage('');
		Reflect.set(page.__ABSOLUTE_PAGE_UPDATE__, 'index', declared);

		return page;
	};

	test('is recognised by the entry it declared', async () => {
		installScriptless(`http://localhost${INDEX}`);
		answerWith({ body: envelope({ todos: ['a'] }) });

		expect(await run()).toBe('updated');
		expect(applied.props).toEqual([{ todos: ['a'] }]);
	});

	test('is still refused data that names another page', async () => {
		installScriptless('http://localhost/svelte/indexes/Other.zzz.js');
		answerWith();

		expect(await run()).toBeUndefined();
		expect(applied.props).toEqual([]);
	});

	test('with neither a script nor a declared entry, nothing is assumed', async () => {
		installPage('');
		answerWith();

		expect(await run()).toBeUndefined();
	});
});

describe('a refresh that must not be done in place', () => {
	const declined = async (answer: Answer) => {
		installPage();
		answerWith(answer);
		const outcome = await run();

		expect(applied.props).toEqual([]);

		return outcome;
	};

	/* The session ended and the route sends everyone to /login: the
	 * props that came back are the login page's. */
	test('the request was redirected', async () => {
		expect(await declined({ redirected: true })).toBeUndefined();
	});

	test('the route answered for a different page', async () => {
		expect(
			await declined({
				body: envelope(
					{ user: null },
					'/react/indexes/LoginIndex.xyz.js'
				)
			})
		).toBeUndefined();
	});

	test('the server sent the document, not data', async () => {
		expect(
			await declined({ body: '<html></html>', contentType: 'text/html' })
		).toBeUndefined();
	});

	test('the route failed', async () => {
		expect(await declined({ status: 500 })).toBeUndefined();
		expect(await declined({ status: 404 })).toBeUndefined();
	});

	test('the data is not a page’s', async () => {
		expect(
			await declined({
				body: { code: 'representation-failed', kind: 'error' }
			})
		).toBeUndefined();
		expect(
			await declined({
				body: { assets: { index: INDEX }, kind: 'route' }
			})
		).toBeUndefined();
		expect(await declined({ body: 'not an object' })).toBeUndefined();
	});

	test('the request could not be made at all', async () => {
		installPage();
		globalThis.fetch = Object.assign(
			() => Promise.reject(new TypeError('offline')),
			{ preconnect: originalFetch.preconnect }
		);

		expect(await run()).toBeUndefined();
		expect(applied.props).toEqual([]);
	});

	test('the page could not take the props', async () => {
		const page = installPage();
		page.__ABSOLUTE_PAGE_UPDATE__ = () => false;
		answerWith();

		expect(await run()).toBeUndefined();
	});

	/* The visitor navigated away while the data was on its way: the
	 * page that asked is gone, and the one there now did not ask. */
	test('the page was replaced while the data was on its way', async () => {
		const page = installPage();
		answerWith();
		const update = readPageUpdate();
		if (!update) throw new Error('unreachable');

		const pending = refreshInPlace(update);
		page.__ABSOLUTE_PAGE_UPDATE__ = () => true;

		expect(await pending).toBeUndefined();
		expect(applied.props).toEqual([]);
	});
});

describe('a refresh that is stopped', () => {
	test('a listener can refuse it, and nothing is fetched', async () => {
		const page = installPage();
		const requests = answerWith();
		page.addEventListener('absolute:before-navigate', (event) =>
			event.preventDefault()
		);

		expect(await run()).toBe('cancelled');
		expect(requests).toEqual([]);
		expect(applied.props).toEqual([]);
	});

	/* Two changes in a row: only the answer to the later request may be
	 * applied, or the page could end on the older data. */
	test('an earlier refresh gives way to a later one', async () => {
		installPage();
		answerWith({ body: envelope({ todos: ['latest'] }) });

		const [first, second] = await Promise.all([run(), run()]);

		expect(first).toBe('superseded');
		expect(second).toBe('updated');
		expect(applied.props).toEqual([{ todos: ['latest'] }]);
	});
});

describe('invalidate()', () => {
	test('refreshes in place when the page can take new props', async () => {
		installPage();
		answerWith();

		expect(await invalidate()).toBe('updated');
	});

	/* Declined in place, so the page is refreshed whole: through the
	 * navigation layer when there is one. */
	test('falls back to the whole-page refresh when that is declined', async () => {
		installPage();
		answerWith({ redirected: true });
		const calls: string[] = [];
		Reflect.set(globalThis, NAVIGATION_RUNTIME, {
			disable: () => undefined,
			navigate: () => Promise.resolve('swapped'),
			refresh: () => {
				calls.push('refresh');

				return Promise.resolve('swapped');
			}
		});

		expect(await invalidate()).toBe('swapped');
		expect(calls).toEqual(['refresh']);
	});

	test('does not fall back when a listener cancelled it', async () => {
		const page = installPage();
		answerWith();
		page.addEventListener('absolute:before-navigate', (event) =>
			event.preventDefault()
		);
		const calls: string[] = [];
		Reflect.set(globalThis, NAVIGATION_RUNTIME, {
			disable: () => undefined,
			navigate: () => Promise.resolve('swapped'),
			refresh: () => {
				calls.push('refresh');

				return Promise.resolve('swapped');
			}
		});

		expect(await invalidate()).toBe('cancelled');
		expect(calls).toEqual([]);
	});
});

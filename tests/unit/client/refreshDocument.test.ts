import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { invalidate } from '../../../src/client/invalidate';
import {
	isDocumentPage,
	refreshDocumentInPlace
} from '../../../src/client/refreshDocument';

/* Refreshing a page that has no framework: when the document is morphed
 * into a fresh copy, and when that is declined and left to the
 * whole-page refresh. What the morph does to the nodes is morph.test.ts;
 * what a browser does with a real page is the browser test. */

beforeAll(() => GlobalRegistrator.register({ url: 'http://localhost/todos' }));
afterAll(() => GlobalRegistrator.unregister());

const originalFetch = globalThis.fetch;
const FRAMEWORK_GLOBALS = [
	'__ABSOLUTE_PAGE_READY__',
	'__INITIAL_PROPS__',
	'__ABS_ANGULAR_REQUEST_CONTEXT__',
	'__ABSOLUTE_PAGE_UPDATE__',
	'htmx'
];

const documentOf = (body: string, head = '<title>Todos</title>') =>
	`<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

type Answer = {
	body?: string;
	contentType?: string;
	redirected?: boolean;
	status?: number;
};

const answerWith = ({
	body = documentOf('<p id="count">2</p>'),
	contentType = 'text/html; charset=utf-8',
	redirected = false,
	status = 200
}: Answer = {}) => {
	const requests: RequestInit[] = [];
	const stub = (_input: unknown, init?: RequestInit) => {
		requests.push(init ?? {});
		const response = new Response(body, {
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

/* Before as well as after: another test file in this process may have
 * left a page's globals behind, and the first test here would then find
 * a framework page where it expects none. */
const clearFrameworkGlobals = () =>
	FRAMEWORK_GLOBALS.forEach((name) => {
		Reflect.deleteProperty(window, name);
		Reflect.deleteProperty(globalThis, name);
	});

beforeEach(() => {
	clearFrameworkGlobals();
	document.head.innerHTML = '<title>Todos</title>';
	document.body.innerHTML = '<p id="count">1</p>';
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	clearFrameworkGlobals();
});

const count = () => document.querySelector('#count')?.textContent;

describe('which pages have no framework', () => {
	test('one where nothing registered as ready and no props were sent', () => {
		expect(isDocumentPage()).toBe(true);
	});

	/* A framework owns its markup. Morphing it — an Angular page that
	 * copies its context, say, which cannot be given new data — would
	 * pull the page out from under the framework. */
	test.each([
		[
			'a framework app that registered as ready',
			'__ABSOLUTE_PAGE_READY__',
			Promise.resolve()
		],
		['a page that was sent props', '__INITIAL_PROPS__', {}],
		[
			'an Angular page that was sent a context',
			'__ABS_ANGULAR_REQUEST_CONTEXT__',
			null
		]
	])('not %s', (_label, name, value) => {
		Reflect.set(window, name, value);

		expect(isDocumentPage()).toBe(false);
	});
});

describe('a page with no framework, refreshed', () => {
	test('is morphed into the fresh copy, and the kept nodes are the same nodes', async () => {
		const paragraph = document.querySelector('#count');
		answerWith();

		expect(await refreshDocumentInPlace()).toBe('updated');
		expect(count()).toBe('2');
		expect(document.querySelector('#count')).toBe(paragraph);
	});

	test('asks for the document, past the HTTP cache', async () => {
		const requests = answerWith();

		await refreshDocumentInPlace();

		expect(requests[0]?.cache).toBe('reload');
		expect(requests[0]?.credentials).toBe('same-origin');
		expect(new Headers(requests[0]?.headers).get('accept')).toBe(
			'text/html'
		);
	});

	test('takes the new title', async () => {
		answerWith({
			body: documentOf('<p id="count">2</p>', '<title>Todos (2)</title>')
		});

		await refreshDocumentInPlace();

		expect(document.title).toBe('Todos (2)');
	});

	/* Markup that arrived has not been seen by HTMX, so its `hx-*`
	 * attributes would do nothing. */
	test('has HTMX look at the document again', async () => {
		const processed: unknown[] = [];
		Reflect.set(window, 'htmx', {
			process: (element: unknown) => processed.push(element)
		});
		answerWith();

		await refreshDocumentInPlace();

		expect(processed).toEqual([document.body]);
	});

	test('announces itself, and a listener can refuse it', async () => {
		const requests = answerWith();
		const refuse = (event: Event) => event.preventDefault();
		window.addEventListener('absolute:before-navigate', refuse);
		try {
			expect(await refreshDocumentInPlace()).toBe('cancelled');
			expect(requests).toEqual([]);
			expect(count()).toBe('1');
		} finally {
			window.removeEventListener('absolute:before-navigate', refuse);
		}
	});

	test('an earlier refresh gives way to a later one', async () => {
		answerWith();

		const [first, second] = await Promise.all([
			refreshDocumentInPlace(),
			refreshDocumentInPlace()
		]);

		expect(first).toBe('superseded');
		expect(second).toBe('updated');
	});
});

describe('a refresh that must not be done by morphing', () => {
	const declined = async (answer: Answer) => {
		answerWith(answer);
		const outcome = await refreshDocumentInPlace();

		// Nothing in the document was touched.
		expect(count()).toBe('1');

		return outcome;
	};

	test('the request was redirected', async () => {
		expect(await declined({ redirected: true })).toBeUndefined();
	});

	test('the answer is not a document', async () => {
		expect(
			await declined({ body: '{}', contentType: 'application/json' })
		).toBeUndefined();
	});

	test('the route failed', async () => {
		expect(await declined({ status: 500 })).toBeUndefined();
	});

	/* A page that now needs a stylesheet this one never loaded needs
	 * more than its markup changed. */
	test('the fresh copy loads different stylesheets', async () => {
		expect(
			await declined({
				body: documentOf(
					'<p id="count">2</p>',
					'<title>Todos</title><link rel="stylesheet" href="/new.css">'
				)
			})
		).toBeUndefined();
	});

	/* Islands have to be mounted and disposed, which is not something
	 * changing markup does. */
	test('the fresh copy holds a different number of islands', async () => {
		expect(
			await declined({
				body: documentOf(
					'<p id="count">2</p><div data-island="true"></div>'
				)
			})
		).toBeUndefined();
	});

	test('the request could not be made', async () => {
		globalThis.fetch = Object.assign(
			() => Promise.reject(new TypeError('offline')),
			{ preconnect: originalFetch.preconnect }
		);

		expect(await refreshDocumentInPlace()).toBeUndefined();
		expect(count()).toBe('1');
	});
});

describe('invalidate()', () => {
	test('morphs a page that has no framework', async () => {
		answerWith();

		expect(await invalidate()).toBe('updated');
		expect(count()).toBe('2');
	});

	test('does not morph a framework page it cannot give new data', async () => {
		Reflect.set(window, '__ABSOLUTE_PAGE_READY__', Promise.resolve());
		const requests = answerWith();
		const { reload } = window.location;
		const reloads: number[] = [];
		window.location.reload = () => {
			reloads.push(1);
		};
		try {
			expect(await invalidate()).toBe('reloaded');
			expect(requests).toEqual([]);
			expect(count()).toBe('1');
			expect(reloads).toEqual([1]);
		} finally {
			window.location.reload = reload;
		}
	});
});

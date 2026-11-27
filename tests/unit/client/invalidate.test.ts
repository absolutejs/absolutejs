import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { submitFormAction } from '../../../src/client/formActions';
import { invalidate } from '../../../src/client/invalidate';

/* `invalidate()` on its own: which of the two ways of showing the page
 * again it picks, and when a form action asks for it. What the refresh
 * then does to a real page is the browser test's subject
 * (tests/integration/build/invalidate-browser.test.ts). */

const NAVIGATION_RUNTIME = Symbol.for('absolutejs.navigation');
const originalFetch = globalThis.fetch;
const originalWindow: unknown = Reflect.get(globalThis, 'window');
const originalDocument: unknown = Reflect.get(globalThis, 'document');

type Calls = { refreshes: number; reloads: number };

const calls: Calls = { refreshes: 0, reloads: 0 };

/* Just enough window for `invalidate` to believe it is in a browser.
 * Another test file in this process may have installed a DOM library,
 * so whatever was there is put back afterwards. */
const installWindow = () => {
	Reflect.set(globalThis, 'window', {
		// A framework page that has finished starting, and has no way
		// to take new props: the case the whole-page refresh is for.
		// Without this the page would read as one with no framework,
		// which is refreshed by morphing (refreshDocument.test.ts).
		__ABSOLUTE_PAGE_READY__: Promise.resolve(),
		location: {
			reload: () => {
				calls.reloads += 1;
			}
		}
	});
};

const installLayer = (outcome: unknown = 'swapped') => {
	Reflect.set(globalThis, NAVIGATION_RUNTIME, {
		disable: () => undefined,
		navigate: () => Promise.resolve('swapped'),
		refresh: () => {
			calls.refreshes += 1;

			return Promise.resolve(outcome);
		}
	});
};

const answerWith = (payload: unknown) => {
	const stub = () =>
		Promise.resolve(
			new Response(JSON.stringify(payload), {
				headers: { 'content-type': 'application/json' }
			})
		);
	globalThis.fetch = Object.assign(stub, {
		preconnect: originalFetch.preconnect
	});
};

/* The refresh is queued behind the caller's own continuation. */
const settle = () => Bun.sleep(5);

beforeEach(() => {
	calls.refreshes = 0;
	calls.reloads = 0;
	installWindow();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	Reflect.deleteProperty(globalThis, NAVIGATION_RUNTIME);
	if (originalWindow === undefined)
		Reflect.deleteProperty(globalThis, 'window');
	else Reflect.set(globalThis, 'window', originalWindow);
	if (originalDocument === undefined)
		Reflect.deleteProperty(globalThis, 'document');
	else Reflect.set(globalThis, 'document', originalDocument);
});

describe('invalidate()', () => {
	test('asks the navigation layer to refresh, and reports how it ended', async () => {
		installLayer('superseded');

		expect(await invalidate()).toBe('superseded');
		expect(calls).toEqual({ refreshes: 1, reloads: 0 });
	});

	test('reloads the page when there is no navigation layer', async () => {
		expect(await invalidate()).toBe('reloaded');
		expect(calls).toEqual({ refreshes: 0, reloads: 1 });
	});

	/* A layer from before `refresh` existed, in a bundle built earlier:
	 * the page must still end up fresh. */
	test('reloads when the installed layer cannot refresh', async () => {
		Reflect.set(globalThis, NAVIGATION_RUNTIME, {
			disable: () => undefined,
			navigate: () => Promise.resolve('swapped')
		});

		expect(await invalidate()).toBe('reloaded');
		expect(calls.reloads).toBe(1);
	});

	test('does nothing outside a browser', async () => {
		Reflect.deleteProperty(globalThis, 'window');
		installLayer();

		expect(await invalidate()).toBe('cancelled');
		expect(calls).toEqual({ refreshes: 0, reloads: 0 });
	});
});

describe('a form action with invalidate', () => {
	test('refreshes the page after a success', async () => {
		installLayer();
		answerWith({ data: { id: 1 }, status: 'success' });

		const result = await submitFormAction('/actions/add', new FormData(), {
			invalidate: true
		});
		// The caller has the result before the page is touched.
		expect(result.status).toBe('success');
		expect(calls.refreshes).toBe(0);
		await settle();

		expect(calls.refreshes).toBe(1);
	});

	/* The page here cannot take new props, so refreshing it means
	 * mounting it again. Nobody asked for that. */
	test('left to itself, never mounts the page again or reloads it', async () => {
		installLayer();
		answerWith({ status: 'success' });

		await submitFormAction('/actions/add', new FormData());
		await settle();

		expect(calls.refreshes).toBe(0);
		expect(calls.reloads).toBe(0);
	});

	test('left to itself, hands new props to a page that can take them', async () => {
		const requested: string[] = [];
		const given: unknown[] = [];
		Reflect.set(globalThis, 'document', {
			cookie: '',
			scripts: [{ src: 'http://localhost/indexes/Todos.js' }],
			title: 'Todos'
		});
		Reflect.set(globalThis, 'window', {
			location: {
				href: 'http://localhost/todos',
				reload: () => {
					calls.reloads += 1;
				}
			},
			__ABSOLUTE_PAGE_UPDATE__: (props: unknown) => {
				given.push(props);

				return true;
			},
			addEventListener: () => undefined,
			dispatchEvent: () => true
		});
		const stub = (input: unknown) => {
			requested.push(String(input));
			const isAction = String(input) === '/actions/add';

			return Promise.resolve(
				new Response(
					JSON.stringify(
						isAction
							? { status: 'success' }
							: {
									assets: { index: '/indexes/Todos.js' },
									kind: 'route',
									props: { items: ['a'] }
								}
					),
					{
						headers: {
							'content-type': isAction
								? 'application/json'
								: 'application/vnd.absolute.route+json'
						}
					}
				)
			);
		};
		globalThis.fetch = Object.assign(stub, {
			preconnect: originalFetch.preconnect
		});

		await submitFormAction('/actions/add', new FormData());
		await settle();

		expect(requested).toHaveLength(2);
		expect(given).toEqual([{ items: ['a'] }]);
		expect(calls.reloads).toBe(0);
	});

	test('`invalidate: false` leaves even that page alone', async () => {
		const requested: string[] = [];
		Reflect.set(globalThis, 'window', {
			location: {
				href: 'http://localhost/todos',
				reload: () => undefined
			},
			__ABSOLUTE_PAGE_UPDATE__: () => true
		});
		const stub = (input: unknown) => {
			requested.push(String(input));

			return Promise.resolve(Response.json({ status: 'success' }));
		};
		globalThis.fetch = Object.assign(stub, {
			preconnect: originalFetch.preconnect
		});

		await submitFormAction('/actions/add', new FormData(), {
			invalidate: false
		});
		await settle();

		expect(requested).toEqual(['/actions/add']);
	});

	test('leaves a failed submission on screen', async () => {
		installLayer();
		answerWith({ errors: { title: 'Required' }, status: 'error' });

		await submitFormAction('/actions/add', new FormData(), {
			invalidate: true
		});
		await settle();

		expect(calls.refreshes).toBe(0);
	});

	/* A redirect loads a page anyway; refreshing the one being left
	 * would be a wasted request racing the navigation. */
	test('does not refresh a result that redirects', async () => {
		installLayer();
		answerWith({ redirect: '/done', status: 'success' });

		await submitFormAction('/actions/add', new FormData(), {
			invalidate: true
		});
		await settle();

		expect(calls.refreshes).toBe(0);
	});
});

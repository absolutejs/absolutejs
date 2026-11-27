import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { submitFormAction } from '../../../src/client/formActions';

/* Where a form action is posted to when its path is a ROUTE and not an
 * address. A file route's own action is registered on the page's path,
 * so the typed client knows it as `/blog/:slug` — and the page posting
 * to it is at `/blog/hello`. */

const originalFetch = globalThis.fetch;
const originalWindow: unknown = Reflect.get(globalThis, 'window');

const posted: string[] = [];

const at = (pathname: string) => {
	Reflect.set(globalThis, 'window', {
		// A framework page that cannot be refreshed in place, so the
		// refresh a success would start has nothing to do here.
		__ABSOLUTE_PAGE_READY__: Promise.resolve(),
		location: { pathname, reload: () => undefined }
	});
};

beforeEach(() => {
	posted.length = 0;
	const stub = (input: unknown) => {
		posted.push(String(input));

		return Promise.resolve(Response.json({ errors: {}, status: 'error' }));
	};
	globalThis.fetch = Object.assign(stub, {
		preconnect: originalFetch.preconnect
	});
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalWindow === undefined)
		Reflect.deleteProperty(globalThis, 'window');
	else Reflect.set(globalThis, 'window', originalWindow);
});

const submit = (path: string) => submitFormAction(path, new FormData());

describe('a form action whose path is an address', () => {
	test('is posted to as written, wherever the page is', async () => {
		at('/somewhere/else');

		await submit('/actions/signup');

		expect(posted).toEqual(['/actions/signup']);
	});
});

describe('a form action whose path is a route with params', () => {
	test('is posted to the address the page is at, when that is one of the route’s', async () => {
		at('/blog/hello');

		await submit('/blog/:slug');

		expect(posted).toEqual(['/blog/hello']);
	});

	test('with a trailing slash on the page’s address', async () => {
		at('/blog/hello/');

		await submit('/blog/:slug');

		expect(posted).toEqual(['/blog/hello/']);
	});

	test('an optional param matches with it and without', async () => {
		at('/shop');
		await submit('/shop/:category?');
		at('/shop/hats');
		await submit('/shop/:category?');

		expect(posted).toEqual(['/shop', '/shop/hats']);
	});

	test('a catch-all matches whatever is under it', async () => {
		at('/docs/guide/routing');

		await submit('/docs/*');

		expect(posted).toEqual(['/docs/guide/routing']);
	});

	/* Posting a literal `:slug` would be answered by the route, for a
	 * post called ":slug". Nothing is sent, and the form is told why. */
	test('from a page at no address of that route, sends nothing and says what to pass', async () => {
		at('/about');

		const result = await submit('/blog/:slug');

		expect(posted).toEqual([]);
		expect(result).toMatchObject({ status: 'error' });
		expect(result.status === 'error' ? result.message : '').toContain(
			"route('/blog/:slug'"
		);
	});

	test('does not mistake a longer address for the route’s', async () => {
		at('/blog/hello/comments');

		await submit('/blog/:slug');

		expect(posted).toEqual([]);
	});
});

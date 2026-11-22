import { describe, expect, test } from 'bun:test';
import { route } from '../../../src/utils/route';

/* `route()` builds the URL for a typed path. These cover the runtime
 * half; the type half — an unknown path, a missing param, a misspelled
 * one — is checked by
 * tests/integration/cli/typecheck-route-map.test.ts, because a type error
 * cannot be asserted from inside a passing test file. */

describe('route', () => {
	test('returns a path with no params unchanged', () => {
		expect(route('/pricing')).toBe('/pricing');
		expect(route('/')).toBe('/');
	});

	test('fills params', () => {
		expect(route('/blog/:slug', { slug: 'hello' })).toBe('/blog/hello');
		expect(route('/:org/:repo/issues', { org: 'a', repo: 'b' })).toBe(
			'/a/b/issues'
		);
	});

	test('stringifies a number param', () => {
		expect(route('/posts/:id', { id: 7 })).toBe('/posts/7');
	});

	test('encodes a value', () => {
		expect(route('/blog/:slug', { slug: 'a b&c?d' })).toBe(
			'/blog/a%20b%26c%3Fd'
		);
	});

	/* A catch-all's value is a path, and the typed path cannot say which
	 * param is the catch-all one (`[...rest]` and `[rest]` are both typed
	 * `:rest`), so `/` is preserved in every value and each part encoded
	 * separately. */
	test('keeps a / in a value as a separator, encoding each part', () => {
		expect(route('/docs/:rest', { rest: 'guide/routing' })).toBe(
			'/docs/guide/routing'
		);
		expect(route('/docs/:rest', { rest: 'a b/c&d' })).toBe(
			'/docs/a%20b/c%26d'
		);
	});

	/* An `[[optional]]` route registers two paths; which one this is comes
	 * from whether the param has a value. */
	test('drops an absent optional segment', () => {
		expect(route('/:lang?/about', { lang: 'fr' })).toBe('/fr/about');
		expect(route('/:lang?/about', { lang: undefined })).toBe('/about');
		expect(route('/:lang?/about', { lang: '' })).toBe('/about');
	});

	test('an optional segment is all there is', () => {
		expect(route('/:lang?', { lang: undefined })).toBe('/');
		expect(route('/:lang?', { lang: 'fr' })).toBe('/fr');
	});

	/* The type system catches this at every call site it can see; this is
	 * the answer where it cannot — a value read from an API, a param
	 * built in a loop. A thrown error names the route and the param,
	 * because the alternative is a URL with a literal `:slug` in it that
	 * 404s somewhere else entirely. */
	test('throws, naming the route and the param, when a required one is missing', () => {
		/* Through a `string`-typed path, because a literal one is checked:
		 * `route('/blog/:slug', { slug: undefined })` does not compile,
		 * which is the whole point. A path assembled at runtime is the
		 * case the types cannot see, and the one this guard is for. */
		const dynamicPath: string = '/blog/:slug';

		expect(() => route(dynamicPath, {})).toThrow(
			'route("/blog/:slug") is missing the "slug" param'
		);
	});
});

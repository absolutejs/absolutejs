import { describe, expect, test } from 'bun:test';
import { resolveRouterHandoff } from '../../../src/angular/components/router-handoff';

/* The decision inside the Angular navigation-error handler, without a
 * router: which failed navigations become a document navigation. The
 * browser half — that a `routerLink` no route matches now reaches the
 * other framework's page — is
 * `tests/integration/ssr/angular-router-page-navigation-browser`. */

const noMatch = (segment: string) =>
	Object.assign(
		new Error(
			`NG04002: Cannot match any routes. URL Segment: '${segment}'`
		),
		{ code: 4002 }
	);

/* What a production Angular build throws: the message is stripped to the
 * segment and the numeric code is all that identifies it. Reading only
 * the message would make this feature work in development and quietly do
 * nothing in production. */
const productionNoMatch = (segment: string) =>
	Object.assign(new Error(`'${segment}'`), { code: 4002 });

describe('resolveRouterHandoff', () => {
	test('a no-match error hands off the URL the router would have shown', () => {
		expect(
			resolveRouterHandoff(noMatch('react'), '/ng/react', '/ng/')
		).toBe('/ng/react');
		expect(
			resolveRouterHandoff(
				productionNoMatch('react'),
				'/ng/react',
				'/ng/'
			)
		).toBe('/ng/react');
	});

	test('an error carrying the code but no recognisable message still counts', () => {
		expect(resolveRouterHandoff({ code: 4002 }, '/ng/react', '/ng/')).toBe(
			'/ng/react'
		);
	});

	test('a message-only no-match counts, for a build that drops the code', () => {
		expect(
			resolveRouterHandoff(
				new Error('NG04002: Cannot match any routes.'),
				'/ng/react',
				'/ng/'
			)
		).toBe('/ng/react');
	});

	test('every other navigation error is left to Angular', () => {
		/* A failed guard, a resolver that threw, a lazy chunk that would
		 * not load: Angular reports these, and a hand-off would turn a
		 * reported error into a page navigation that hides it. */
		expect(
			resolveRouterHandoff(new Error('guard rejected'), '/ng/x', '/ng/')
		).toBeUndefined();
		expect(
			resolveRouterHandoff(
				Object.assign(new Error('NG04004'), { code: 4004 }),
				'/ng/x',
				'/ng/'
			)
		).toBeUndefined();
		expect(
			resolveRouterHandoff(undefined, '/ng/x', '/ng/')
		).toBeUndefined();
		expect(
			resolveRouterHandoff('a string', '/ng/x', '/ng/')
		).toBeUndefined();
	});

	test('the page’s own URL is never handed off', () => {
		/* The failing URL is the one the document is already on — the
		 * router could not match the page's own address. Handing that to
		 * the layer asks it to navigate where it already is, which for the
		 * page-load fallback is an infinite reload. Angular reports it
		 * instead, which is what a genuinely unmatched URL deserves. */
		expect(
			resolveRouterHandoff(noMatch('typo'), '/ng/typo', '/ng/typo')
		).toBeUndefined();
	});
});

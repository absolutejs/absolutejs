import { describe, expect, test } from 'bun:test';
import {
	isUnmatchedColocatedRoute,
	matchesAngularColocatedRoutes,
	pathBelowBaseHref
} from '../../../src/angular/colocatedRouteMatch';

const Component = class {};

type TestRoute = Record<string, unknown>;

const ROUTES: TestRoute[] = [
	{ component: Component, path: '' },
	{ component: Component, path: 'a' },
	{ component: Component, path: 'b/:id' },
	{ path: 'old', redirectTo: 'a' },
	{ children: [{ component: Component, path: 'kid' }], path: 'parent' }
];

const matches = (routes: unknown, path: string) =>
	matchesAngularColocatedRoutes(routes, path);

describe('matchesAngularColocatedRoutes', () => {
	test('matches literal, parameter, redirect and nested child paths', () => {
		for (const path of ['', 'a', 'a/', 'b/5', 'old', 'parent/kid']) {
			expect(matches(ROUTES, path)).toBe(true);
		}
	});

	test('rejects paths no route consumes', () => {
		for (const path of ['nope', 'b', 'b/5/6', 'parent/x', 'a/extra']) {
			expect(matches(ROUTES, path)).toBe(false);
		}
	});

	test('an exhausted URL matches at any level, as in Angular', () => {
		expect(matches([{ path: 'a' }], '')).toBe(true);
		expect(matches(ROUTES, 'parent')).toBe(true);
	});

	test('a ** route matches everything at its level', () => {
		const routes: TestRoute[] = [{ path: 'a' }, { path: '**' }];
		expect(matches(routes, 'anything/at/all')).toBe(true);
		const nested: TestRoute[] = [
			{ children: [{ path: '**' }], path: 'docs' }
		];
		expect(matches(nested, 'docs/x/y')).toBe(true);
		expect(matches(nested, 'other')).toBe(false);
	});

	test('loadChildren matches anything under its prefix', () => {
		const routes: TestRoute[] = [
			{ path: 'lazy', loadChildren: () => Promise.resolve([]) }
		];
		expect(matches(routes, 'lazy/anything/deep')).toBe(true);
		expect(matches(routes, 'eager')).toBe(false);
	});

	test('a matcher function matches everything', () => {
		expect(matches([{ matcher: () => null }], 'x/y')).toBe(true);
	});

	test('pathMatch full needs the whole remaining path', () => {
		expect(matches([{ path: 'a', pathMatch: 'full' }], 'a')).toBe(true);
		expect(
			matches(
				[
					{
						children: [{ path: 'x' }],
						path: 'a',
						pathMatch: 'full'
					}
				],
				'a/x'
			)
		).toBe(false);
		expect(matches([{ path: '', pathMatch: 'full' }], 'x')).toBe(false);
	});

	test('componentless empty-path parents pass segments to their children', () => {
		const routes: TestRoute[] = [
			{
				children: [{ path: 'one' }, { path: 'two/:id' }],
				path: ''
			}
		];
		expect(matches(routes, 'one')).toBe(true);
		expect(matches(routes, 'two/9')).toBe(true);
		expect(matches(routes, 'three')).toBe(false);
	});

	test('an empty-path prefix redirect matches everything', () => {
		expect(matches([{ path: '', redirectTo: 'a' }], 'x/y')).toBe(true);
	});

	test('named-outlet routes never match the primary path', () => {
		expect(matches([{ outlet: 'aside', path: 'x' }], 'x')).toBe(false);
	});

	test('malformed tables and URLs are treated as matching', () => {
		expect(matches(null, 'x')).toBe(true);
		expect(matches(['not a route'], 'x')).toBe(true);
		expect(matches([{ component: Component }], 'x')).toBe(true);
		expect(matches(ROUTES, 'a(aside:x)')).toBe(true);
		expect(matches(ROUTES, '%E0%A4%A')).toBe(true);
	});

	test('matrix parameters and percent-escapes follow Angular', () => {
		expect(matches(ROUTES, 'a;x=1')).toBe(true);
		expect(matches([{ path: 'café' }], 'caf%C3%A9')).toBe(true);
	});
});

describe('pathBelowBaseHref', () => {
	test('strips the base and accepts the bare mount', () => {
		expect(pathBelowBaseHref('/ng', '/ng/')).toBe('');
		expect(pathBelowBaseHref('/ng/', '/ng/')).toBe('');
		expect(pathBelowBaseHref('/ng/a/b', '/ng/')).toBe('a/b');
		expect(pathBelowBaseHref('//ng//a', '/ng/')).toBe('a');
		expect(pathBelowBaseHref('/other', '/ng/')).toBeNull();
	});
});

describe('isUnmatchedColocatedRoute', () => {
	const pageModule: Record<string, unknown> = {
		providers: [],
		routes: ROUTES
	};
	const check = (
		pathname: string,
		overrides: Partial<Parameters<typeof isUnmatchedColocatedRoute>[0]> = {}
	) =>
		isUnmatchedColocatedRoute({
			handlerProviders: undefined,
			pageModule,
			request: new Request(`https://example.com${pathname}`),
			route: '/ng/*',
			runtimeBaseHref: '/ng/',
			...overrides
		});

	test('answers per request from the matched mount', () => {
		expect(check('/ng/nope')).toBe(true);
		expect(check('/ng/a')).toBe(false);
		expect(
			check('/t/acme/nope', {
				route: '/t/:tenant/*',
				runtimeBaseHref: '/t/acme/'
			})
		).toBe(true);
		expect(check('/nope', { route: '/*', runtimeBaseHref: null })).toBe(
			true
		);
	});

	test('stays out when the base or the route table is unknown', () => {
		expect(check('/ng/nope', { route: '/ng/nope' })).toBe(false);
		expect(check('/ng/nope', { route: undefined })).toBe(false);
		expect(check('/ng/nope', { runtimeBaseHref: null })).toBe(false);
		expect(check('/ng/nope', { request: undefined })).toBe(false);
		expect(check('/ng/nope', { pageModule: { routes: ROUTES } })).toBe(
			false
		);
		expect(
			check('/ng/nope', {
				handlerProviders: [
					{
						provide: {
							toString: () => 'InjectionToken appBaseHref'
						}
					}
				]
			})
		).toBe(false);
	});
});

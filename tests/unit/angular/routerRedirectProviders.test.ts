import * as core from '@angular/core';
import * as platformServer from '@angular/platform-server';
import * as router from '@angular/router';
import { describe, expect, test } from 'bun:test';
import { buildRouterRedirectProviders } from '../../../src/angular/routerRedirectProviders';
import { renderAngularApp } from '../../../src/angular/ssrRender';
import { realAngularDeps as deps } from './realAngularDeps';

/* The server watches the Angular router so a guard's redirect becomes an
 * HTTP redirect. It found the router with
 * `inject(Router, { optional: true })`, which does not mean "only if this
 * page has one": `Router` is `providedIn: 'root'`, so asking for it BUILDS
 * one. Every Angular request constructed a router, a location and a
 * history state manager — including on pages with no routes at all.
 *
 * Profiled on the example app's route-less Angular page: 13.5% of the
 * server's CPU. Removing it, with two smaller per-request costs, took
 * steady throughput from 4,343 to 5,154 requests a second. */

const SHELL =
	'<!DOCTYPE html><html><head></head><body><redirect-page></redirect-page></body></html>';

const baseProviders = () => [
	platformServer.provideServerRendering(),
	core.provideZonelessChangeDetection()
];

describe('a page with no routes', () => {
	/* A counting factory stands in for the router, so this observes the
	 * one thing that matters — whether anything ASKED for it. */
	test('never has a router built for it', async () => {
		let asked = 0;
		const countingRouter: core.Provider = {
			provide: router.Router,
			useFactory: () => {
				asked += 1;

				return { events: { subscribe: () => undefined } };
			}
		};
		const Page = core.Component({
			selector: 'redirect-page',
			standalone: true,
			template: '<p>no routes here</p>'
		})(class RoutelessPage {});

		const html = await renderAngularApp(
			deps,
			Page,
			[
				...baseProviders(),
				countingRouter,
				...(await buildRouterRedirectProviders(deps, {}))
			],
			SHELL,
			'/'
		);

		expect(html).toContain('no routes here');
		expect(asked).toBe(0);
	});
});

describe('a page with routes', () => {
	/* The reason the watcher exists, and what the guard above must not
	 * break: a guard that redirects still turns into a 302. */
	test('still turns a guard redirect into an HTTP redirect', async () => {
		const Home = core.Component({
			selector: 'redirect-home',
			standalone: true,
			template: '<p>home</p>'
		})(class RedirectHome {});
		const Login = core.Component({
			selector: 'redirect-login',
			standalone: true,
			template: '<p>login</p>'
		})(class RedirectLogin {});
		const Page = core.Component({
			imports: [router.RouterOutlet],
			selector: 'redirect-page',
			standalone: true,
			template: '<router-outlet />'
		})(class RoutedPage {});
		const routes: router.Routes = [
			{
				canActivate: [
					() => core.inject(router.Router).parseUrl('/login')
				],
				component: Home,
				path: ''
			},
			{ component: Login, path: 'login' }
		];
		const responseInit: ResponseInit = {};

		const html = await renderAngularApp(
			deps,
			Page,
			[
				...baseProviders(),
				router.provideRouter(routes),
				...(await buildRouterRedirectProviders(deps, responseInit))
			],
			SHELL,
			'/'
		);

		expect(html).toContain('login');
		expect(responseInit.status).toBe(302);
		expect(new Headers(responseInit.headers).get('Location')).toBe(
			'/login'
		);
	});
});

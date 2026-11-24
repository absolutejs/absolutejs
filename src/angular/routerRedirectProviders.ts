import type { EnvironmentProviders, Provider } from '@angular/core';
import type { AngularDeps } from '../../types/angular';
import { resolveAngularRuntimePath } from './resolveAngularPackage';
import { isProductionRuntime } from '../utils/runtimeMode';

type AngularRouterModule = typeof import('@angular/router');

const DEFAULT_REDIRECT_STATUS = 302;
const SUCCESS_STATUS = 200;

const isRouterRedirectCancel = (
	event: unknown,
	routerModule: AngularRouterModule
) =>
	event instanceof routerModule.NavigationCancel &&
	event.code === routerModule.NavigationCancellationCode.Redirect;

const getNavigationStartUrl = (
	event: unknown,
	routerModule: AngularRouterModule
) => {
	if (!(event instanceof routerModule.NavigationStart)) return null;

	return event.url;
};

const applyRedirectResponse = (
	responseInit: ResponseInit | undefined,
	location: string
) => {
	if (!responseInit) return;

	const headers = new Headers(responseInit.headers);
	headers.set('Location', location);
	responseInit.headers = headers;

	if (
		typeof responseInit.status === 'undefined' ||
		responseInit.status === SUCCESS_STATUS
	) {
		responseInit.status = DEFAULT_REDIRECT_STATUS;
	}
};

const buildRedirectEventHandler = (
	responseInit: ResponseInit | undefined,
	routerModule: AngularRouterModule
) => {
	let waitingForRedirectTarget = false;

	return (event: unknown) => {
		if (isRouterRedirectCancel(event, routerModule)) {
			waitingForRedirectTarget = true;

			return;
		}

		if (!waitingForRedirectTarget) return;

		const redirectUrl = getNavigationStartUrl(event, routerModule);
		if (!redirectUrl) return;

		applyRedirectResponse(responseInit, redirectUrl);
		waitingForRedirectTarget = false;
	};
};

const importRouterModule = async () => {
	try {
		// §1.1 — bare specifier in dev shares Bun's module cache.
		const spec = isProductionRuntime()
			? resolveAngularRuntimePath('@angular/router')
			: '@angular/router';
		const routerModule: AngularRouterModule = await import(spec);

		return routerModule;
	} catch {
		return null;
	}
};

/* In production the vendor file cannot change under a running server, so
 * the lookup is done once. It used to run per request: a path resolution
 * with an `existsSync` in it, then a dynamic import — a filesystem call
 * and a module-registry lookup on every Angular page, for an answer that
 * is always the same. Dev keeps asking, because a rebuild can replace
 * the module there. */
let productionRouterModule: ReturnType<typeof importRouterModule> | undefined;

const loadRouterModule = () => {
	if (!isProductionRuntime()) return importRouterModule();
	productionRouterModule ??= importRouterModule();

	return productionRouterModule;
};

export const buildRouterRedirectProviders = async (
	deps: AngularDeps,
	responseInit: ResponseInit | undefined
) => {
	const routerModule = await loadRouterModule();
	if (routerModule === null) return [];

	return [
		{
			multi: true,
			provide: deps.ENVIRONMENT_INITIALIZER,
			useValue: () => {
				/* `inject(Router, { optional: true })` does NOT mean "only
				 * if the page has a router". `Router` is `providedIn:
				 * 'root'`, so asking for it BUILDS one — router, location,
				 * history state manager — on every request, including on
				 * pages with no routes at all. Profiled on the example
				 * app's route-less Angular page: 13.5% of the server's CPU.
				 * It also quietly undid the build's own rule of only
				 * wiring the router into pages that export `routes`.
				 *
				 * `ROUTES` has no root factory: it exists only when
				 * `provideRouter` (or `RouterModule.forRoot`) ran. So it
				 * answers the real question — did this page set up
				 * routing — without constructing anything. */
				const routes = deps.inject(routerModule.ROUTES, {
					optional: true
				});
				if (routes === null) return;

				const router = deps.inject(routerModule.Router, {
					optional: true
				});
				if (!router) return;

				router.events.subscribe(
					buildRedirectEventHandler(responseInit, routerModule)
				);
			}
		}
	] satisfies (Provider | EnvironmentProviders)[];
};

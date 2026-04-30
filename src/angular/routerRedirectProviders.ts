import type { EnvironmentProviders, Provider } from '@angular/core';
import type { AngularDeps } from '../../types/angular';
import { resolveAngularPackage } from './resolveAngularPackage';

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

export const buildRouterRedirectProviders = async (
	deps: AngularDeps,
	responseInit: ResponseInit | undefined
) => {
	let routerModule: AngularRouterModule;

	try {
		routerModule = await import(resolveAngularPackage('@angular/router'));
	} catch {
		return [];
	}

	return [
		{
			multi: true,
			provide: deps.ENVIRONMENT_INITIALIZER,
			useValue: () => {
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

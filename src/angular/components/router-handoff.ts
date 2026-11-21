import { Location } from '@angular/common';
import { inject } from '@angular/core';
import { type NavigationError, RedirectCommand, Router } from '@angular/router';

/* `routerLink` to a URL the Angular route table does not match.
 *
 * Angular's answer is NG04002 — the navigation fails, the address bar
 * never changes and the click does nothing. That is right for an Angular
 * application on its own: a URL outside the route table is a programming
 * mistake. In a meta-framework it usually is not. The page next door may
 * be React or Svelte, and a `routerLink` pointing at it is a reasonable
 * thing for someone to write, especially since `routerLink` is how every
 * other link on the page is written.
 *
 * So a no-match becomes a hand-off: the URL the router would have shown
 * goes to the cross-framework navigation layer, which swaps that page in
 * when it is an Absolute page and does a normal page load when it is not.
 * Either way the link goes somewhere and the server gets to answer.
 *
 * Only NG04002 is touched. Every other navigation error returns
 * `undefined` from here, which is Angular's own reporting path — a failed
 * guard, a resolver that threw and a lazy chunk that would not load all
 * behave exactly as they do without this.
 *
 * `absLink` (`link.directive.ts`) remains the deliberate way to leave an
 * Angular app, and the only way to leave its base href: the router's URL
 * space is relative to `APP_BASE_HREF`, so `routerLink="/pricing"` on a
 * page mounted at `/portal/*` means `/portal/pricing` to the router, and
 * that is the URL handed off. */

/* Set on globalThis by `enableNavigation()` so the lookup works whichever
 * bundle copy installed the layer (each framework's client pass bundles
 * its own). Re-declared here, as it is in `src/svelte/router/navigation.ts`,
 * because this directory is partial-compiled in a workspace holding only
 * itself: an import climbing out of it makes that step emit nothing and
 * publishes every Angular component empty. */
const DOCUMENT_NAVIGATION_KEY = Symbol.for('absolutejs.navigation');

/** Angular's `RuntimeErrorCode.NO_MATCH`. The message carries the code in
 *  development (`NG04002: Cannot match any routes…`) and is stripped to
 *  the segment alone in production, so the numeric property is what this
 *  reads, with the message only as a fallback. */
const NO_MATCH_CODE = 4002;
const NO_MATCH_MESSAGE = /NG0?4002/;

const isNoMatchError = (error: unknown) => {
	if (typeof error !== 'object' || error === null) return false;
	if (Reflect.get(error, 'code') === NO_MATCH_CODE) return true;
	const message = Reflect.get(error, 'message');

	return typeof message === 'string' && NO_MATCH_MESSAGE.test(message);
};

/**
 * Whether a failed Angular navigation should become a document
 * navigation, and to where. Separated from the DI glue below so it can be
 * tested without a router.
 *
 * `target` is the document URL the router would have shown (the attempted
 * router URL with the base href applied) and `currentPath` is the
 * document URL now. They are equal when the page's OWN url is the one no
 * route matched — handing that off would ask the layer to navigate to the
 * page it is already on, which for a full load is an infinite reload. In
 * that case Angular reports the error as usual.
 */
export const resolveRouterHandoff = (
	error: unknown,
	target: string,
	currentPath: string
) => {
	if (!isNoMatchError(error)) return undefined;
	if (target === currentPath) return undefined;

	return target;
};

const currentDocumentPath = () =>
	`${window.location.pathname}${window.location.search}`;

/* Through the runtime `enableNavigation()` published rather than by
 * importing it: a soft swap when the layer is installed and the page can
 * be torn down, a normal page load otherwise — the same fallback
 * `navigateDocument()` makes. */
const handOff = (href: string) => {
	const runtime: unknown = Reflect.get(globalThis, DOCUMENT_NAVIGATION_KEY);
	const navigate =
		typeof runtime === 'object' && runtime !== null
			? Reflect.get(runtime, 'navigate')
			: undefined;
	if (typeof navigate === 'function') {
		void Reflect.apply(navigate, undefined, [href]);

		return;
	}
	window.location.assign(href);
};

/**
 * Angular navigation-error handler that hands a URL no route matched to
 * cross-framework document navigation. The build wires it into the
 * `provideRouter(...)` call it injects for a page that exports `routes`;
 * an app that writes its own `provideRouter` can pass it the same way:
 *
 * ```ts
 * provideRouter(routes, withNavigationErrorHandler(absoluteRouterHandoff))
 * ```
 */
export const absoluteRouterHandoff = (event: NavigationError) => {
	if (typeof window === 'undefined') return undefined;
	const router = inject(Router);
	const location = inject(Location);
	const target = resolveRouterHandoff(
		event.error,
		location.prepareExternalUrl(event.url),
		currentDocumentPath()
	);
	if (target === undefined) return undefined;
	handOff(target);

	/* Stay where we are. Returning a redirect is what keeps Angular from
	 * re-throwing the error it just handed us — the console error and the
	 * rejected `navigateByUrl` promise that a dead `routerLink` produces
	 * today — and the current URL is the honest destination: the document
	 * is on its way out, either swapped by the layer or reloaded. */
	return new RedirectCommand(router.parseUrl(router.url), {
		skipLocationChange: true
	});
};

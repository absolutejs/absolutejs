import { escapeScriptContent } from '../utils/escapeScriptContent';
import { nonceAttr, readCspNonce } from '../utils/cspNonceRef';
import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import type { BootstrapContext } from '@angular/platform-browser';
import type { AngularDeps, CachedRouteData } from '../../types/angular';
import {
	getAndClearClientScripts,
	generateClientScriptCode
} from '../utils/registerClientScript';
import { browserTranslationBaselineTag } from '../core/browserTranslation';
import { buildAbsoluteHttpTransferCacheOptions } from './httpTransferCache';
import { buildRequestProviders } from './requestProviders';
import { insertBeforeMarker } from '../utils/insertBeforeMarker';
import { isAngularZoneMode } from './zoneRuntime';

// --- Last-used requestContext cache for HMR ---
// Stores { requestContext, headTag } from the most recent real request per
// route so HMR re-renders with the same data the user last saw.

const routeContextCache = new Map<string, CachedRouteData>();

export const cacheRouteData = (pagePath: string, data: CachedRouteData) => {
	const cacheKey = pagePath.split('?')[0] ?? pagePath;
	routeContextCache.set(cacheKey, data);
};
export const getCachedRouteData = (pagePath: string) =>
	routeContextCache.get(pagePath);

// --- Selector cache ---

const selectorCache = new Map<string, string>();
export const buildProviders = (
	deps: AngularDeps,
	sanitizer: InstanceType<AngularDeps['DomSanitizer']>,
	request: Request | undefined,
	requestContext: unknown,
	responseInit: ResponseInit | undefined,
	userProviders: ReadonlyArray<Provider | EnvironmentProviders> = []
) => [
	deps.provideServerRendering(),
	/* `withEventReplay` on both sides, because a click before hydration is
	 * otherwise lost. `provideClientHydration()` with no features gives DOM
	 * hydration and the transfer cache and nothing else, so a page that
	 * took a moment to hydrate dropped every tap made in that moment —
	 * silently, and worst on the slow devices where the window is widest.
	 * Angular's own SSR scaffold enables this, so the default here was
	 * behind the framework's own.
	 *
	 * The server's half is what makes it work: with this provider the SSR
	 * render stamps the `jsaction` attributes the replay reads, and the
	 * client half is in the page index that `compileAngular` generates. */
	deps.provideClientHydration(
		deps.withEventReplay(),
		deps.withHttpTransferCacheOptions(
			buildAbsoluteHttpTransferCacheOptions()
		)
	),
	isAngularZoneMode()
		? deps.provideZoneChangeDetection({ eventCoalescing: true })
		: deps.provideZonelessChangeDetection(),
	{ provide: deps.APP_BASE_HREF, useValue: '/' },
	{ provide: deps.DomSanitizer, useValue: sanitizer },
	{ provide: deps.Sanitizer, useValue: sanitizer },
	...buildRequestProviders(deps, request, requestContext, responseInit),
	...userProviders
];
export const clearSelectorCache = () => selectorCache.clear();

export const resolveSelector = (
	deps: AngularDeps,
	pagePath: string,
	PageComponent: Type<unknown>
) => {
	const cached = selectorCache.get(pagePath);
	if (cached) {
		return cached;
	}

	const selector =
		deps.reflectComponentType(PageComponent)?.selector ?? 'ng-app';
	selectorCache.set(pagePath, selector);

	return selector;
};

// --- Inject HTML helper ---

const injectBeforeClose = (html: string, snippet: string) =>
	insertBeforeMarker(html, '</body>', snippet) ??
	insertBeforeMarker(html, '</html>', snippet) ??
	html + snippet;

// --- Post-render HTML injection ---

export const injectSsrScripts = (
	html: string,
	requestId: string,
	indexPath: string,
	requestContext?: unknown,
	baseHref?: string | null
) => {
	/* Collected and inserted ONCE. Each of these used to be its own
	 * search-and-copy of the whole document — five passes over the page
	 * for five snippets that all land in the same place, in this order. */
	const snippets = [browserTranslationBaselineTag()];

	const registeredScripts = getAndClearClientScripts(requestId);
	if (registeredScripts.length > 0) {
		snippets.push(generateClientScriptCode(registeredScripts));
	}

	if (requestContext !== undefined) {
		snippets.push(
			`<script${nonceAttr()}>window.__ABS_ANGULAR_REQUEST_CONTEXT__ = ${escapeScriptContent(JSON.stringify(requestContext))};</script>`
		);
	}

	// Read by the generated client bootstrap so the browser router uses
	// the same `APP_BASE_HREF` the server rendered with.
	if (baseHref) {
		snippets.push(
			`<script${nonceAttr()}>window.__ABS_ANGULAR_BASE_HREF__ = ${escapeScriptContent(JSON.stringify(baseHref))};</script>`
		);
	}

	if (indexPath) {
		const escapedIndexPath = JSON.stringify(indexPath);
		snippets.push(
			`<script${nonceAttr()}>import(${escapeScriptContent(escapedIndexPath)});</script>`
		);
	}

	return injectBeforeClose(html, snippets.join(''));
};
/* `renderApplication` finishes the HTML and then, in a `finally`, awaits
 * `asyncDestroyPlatform` — a `setTimeout(0)` — before returning the
 * string. The page is complete and waits out a timer tick for a teardown
 * that cannot change it.
 *
 * A timer tick is not free: a bare `setTimeout(0)` hop measures 1.14ms
 * here, against 0.14ms of actual rendering work. So nine tenths of an
 * Angular render was idle — 1.360ms per render sequentially where the
 * work is 0.085ms — which is why Angular pages served 575 requests a
 * second at one connection while React, Vue and Svelte served 11,000 to
 * 16,000, and why Angular alone got FASTER per request as concurrency
 * rose: on one thread, only waiting can overlap.
 *
 * So the HTML is handed back the moment it exists. `BEFORE_APP_SERIALIZED`
 * callbacks run immediately before `PlatformState.renderToString()`, the
 * single call that produces the document — after hydration annotation
 * and after every other callback has settled, since they are all invoked
 * before any is awaited. Wrapping that one method on this request's own
 * `PlatformState` resolves a promise with exactly the string
 * `renderApplication` is about to return.
 *
 * All of it is public API, and it fails toward today's behaviour: the
 * hand-off is raced against `renderApplication` itself, so if a future
 * Angular stops calling the wrapped method the race is simply won by the
 * slow path. Teardown still runs — one tick later, off the response
 * path — so `ngOnDestroy` and `DestroyRef` callbacks fire as before. */
const createHtmlHandoff = (deps: AngularDeps) => {
	const { BEFORE_APP_SERIALIZED: token, PlatformState: State } = deps;
	if (token === undefined || State === undefined) return null;

	const { promise, resolve } = Promise.withResolvers<string>();
	const provider: Provider = {
		multi: true,
		provide: token,
		useFactory: () => {
			const state = deps.inject(State);

			return () => {
				const serialize = state.renderToString.bind(state);
				state.renderToString = () => {
					const html = serialize();
					resolve(html);

					return html;
				};
			};
		}
	};

	return { html: promise, provider };
};

export const renderAngularApp = async (
	deps: AngularDeps,
	PageComponent: Type<unknown>,
	providers: (Provider | EnvironmentProviders)[],
	document: string | Document,
	url: string = '/'
) => {
	// Angular writes this nonce on its own <style> and event-replay
	// scripts when secureHeaders() is on.
	const nonce = readCspNonce();
	const cspProviders = nonce
		? [{ provide: deps.CSP_NONCE, useValue: nonce }]
		: [];
	const handoff = createHtmlHandoff(deps);
	const handoffProviders = handoff === null ? [] : [handoff.provider];
	const bootstrap = (context: BootstrapContext) =>
		deps.bootstrapApplication(
			PageComponent,
			{
				providers: [...providers, ...cspProviders, ...handoffProviders]
			},
			context
		);

	return withSuppressedAngularDevLogs(() => {
		const rendered = deps.renderApplication(bootstrap, {
			document,
			platformProviders: [],
			url
		});
		if (handoff === null) return rendered;

		/* A render that fails never reaches the serializer, so the race
		 * is won by `rendered` rejecting and the caller sees the error
		 * exactly as before. Nothing can reject AFTER the hand-off:
		 * Angular's teardown runs inside its own timer callback, so a
		 * throwing `ngOnDestroy` surfaces as an uncaught exception there
		 * and leaves `renderApplication` pending forever. That used to
		 * hang the request; the page is now already delivered. */
		return Promise.race([handoff.html, rendered]);
	});
};
/* Angular logs "Angular is running in development mode." on every
 * `bootstrapApplication`, which on a server is once per request. It has
 * to be filtered, and the filter has to be installed exactly once.
 *
 * It used to save `console.log`, replace it, and restore it in a
 * `finally` — per render. Under concurrency that leaks, because each
 * render captures whatever is installed when IT starts and reinstalls
 * that when IT finishes, so the last render to finish wins. Measured
 * with eight concurrent renders completing in start order: `console.log`
 * is left permanently wrapped, and one wrapper accumulates per round.
 * After 60 rounds — 480 renders, a few seconds of traffic — 20,000
 * `console.log` calls went from 0.3ms to 79.7ms, because every log in
 * the process walks the whole chain. A message containing the filtered
 * phrase was also swallowed for the life of the process.
 *
 * A counter and one install fix both: nothing nests, nothing
 * accumulates, and the filter is only active while a render is actually
 * in flight rather than forever. */
let rendersInFlight = 0;
let filterInstalled = false;

/* Narrowed to Angular's own notice rather than any line containing
 * "development mode", so an application's own logging is not caught by a
 * phrase it happens to share. If a future Angular reworded this, the
 * notice reappears — noisy, which is the right way round for a filter to
 * fail. */
const isAngularDevModeNotice = (args: readonly unknown[]) => {
	const [first] = args;

	return (
		typeof first === 'string' &&
		first.includes('development mode') &&
		first.includes('Angular')
	);
};

/** Whether the installed filter would drop this line right now.
 *
 *  Exported so the behaviour can be tested without intercepting
 *  `console.log`: the wrapper closes over whatever was installed when it
 *  was created, so a test that swaps `console.log` afterwards observes
 *  nothing, and one that swaps it beforehand only works if it happens to
 *  be the first thing in the process to touch this module. Both are
 *  order-dependent, and the second passed alone and failed in the shared
 *  unit run. */
export const shouldSuppressAngularLog = (args: readonly unknown[]) =>
	rendersInFlight > 0 && isAngularDevModeNotice(args);

const installDevLogFilter = () => {
	if (filterInstalled) return;
	filterInstalled = true;
	const original = console.log;
	console.log = (...args: unknown[]) => {
		if (shouldSuppressAngularLog(args)) return;
		original.apply(console, args);
	};
};

export const withSuppressedAngularDevLogs = async <T>(
	render: () => Promise<T>
) => {
	installDevLogFilter();
	rendersInFlight += 1;
	try {
		return await render();
	} finally {
		rendersInFlight -= 1;
	}
};

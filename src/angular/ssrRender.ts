import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import type { BootstrapContext } from '@angular/platform-browser';
import type { AngularDeps, CachedRouteData } from '../../types/angular';
import {
	getAndClearClientScripts,
	generateClientScriptCode
} from '../utils/registerClientScript';
import { buildAbsoluteHttpTransferCacheOptions } from './httpTransferCache';
import { buildRequestProviders } from './requestProviders';

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
): (Provider | EnvironmentProviders)[] => [
	deps.provideServerRendering(),
	deps.provideClientHydration(
		deps.withHttpTransferCacheOptions(
			buildAbsoluteHttpTransferCacheOptions()
		)
	),
	deps.provideZonelessChangeDetection(),
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

const injectBeforeClose = (html: string, snippet: string) => {
	if (html.includes('</body>')) {
		return html.replace('</body>', `${snippet}</body>`);
	}
	if (html.includes('</html>')) {
		return html.replace('</html>', `${snippet}</html>`);
	}

	return html + snippet;
};

// --- Post-render HTML injection ---

export const injectSsrScripts = (
	html: string,
	requestId: string,
	indexPath: string,
	requestContext?: unknown
) => {
	let result = html;

	const registeredScripts = getAndClearClientScripts(requestId);
	if (registeredScripts.length > 0) {
		result = injectBeforeClose(
			result,
			generateClientScriptCode(registeredScripts)
		);
	}

	if (requestContext !== undefined) {
		result = injectBeforeClose(
			result,
			`<script>window.__ABS_ANGULAR_REQUEST_CONTEXT__ = ${JSON.stringify(requestContext)};</script>`
		);
	}

	if (indexPath) {
		const escapedIndexPath = JSON.stringify(indexPath);
		result = injectBeforeClose(
			result,
			`<script>import(${escapedIndexPath});</script>`
		);
	}

	return result;
};
export const renderAngularApp = async (
	deps: AngularDeps,
	PageComponent: Type<unknown>,
	providers: (Provider | EnvironmentProviders)[],
	document: string | Document,
	url: string = '/'
) => {
	const bootstrap = (context: BootstrapContext) =>
		deps.bootstrapApplication(PageComponent, { providers }, context);

	return withSuppressedAngularDevLogs(() =>
		deps.renderApplication(bootstrap, {
			document,
			platformProviders: [],
			url
		})
	);
};
export const withSuppressedAngularDevLogs = async <T>(
	render: () => Promise<T>
) => {
	const origLog = console.log;
	console.log = (...args: unknown[]) => {
		if (
			typeof args[0] === 'string' &&
			args[0].includes('development mode')
		) {
			return;
		}
		origLog.apply(console, args);
	};

	try {
		return await render();
	} finally {
		console.log = origLog;
	}
};

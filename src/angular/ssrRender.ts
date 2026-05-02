import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import type { BootstrapContext } from '@angular/platform-browser';
import type { AngularDeps, CachedRouteData } from '../../types/angular';
import { toScreamingSnake } from '../utils/stringModifiers';
import {
	getAndClearClientScripts,
	generateClientScriptCode
} from '../utils/registerClientScript';
import { buildAbsoluteHttpTransferCacheOptions } from './httpTransferCache';
import { buildRequestProviders } from './requestProviders';

// --- Last-used props cache for HMR ---
// Stores { props, headTag } from the most recent real request per route
// so HMR re-renders with the same data the user last saw (Vite/Next behavior).

const routePropsCache = new Map<string, CachedRouteData>();

export const cacheRouteData = (pagePath: string, data: CachedRouteData) => {
	const cacheKey = pagePath.split('?')[0] ?? pagePath;
	routePropsCache.set(cacheKey, data);
};
export const getCachedRouteData = (pagePath: string) =>
	routePropsCache.get(pagePath);

// --- Selector cache ---

const selectorCache = new Map<string, string>();
export const buildProviders = (
	deps: AngularDeps,
	sanitizer: InstanceType<AngularDeps['DomSanitizer']>,
	maybeProps: Record<string, unknown> | undefined,
	tokenMap: Map<string, unknown>,
	request: Request | undefined,
	requestContext: unknown,
	responseInit: ResponseInit | undefined,
	userProviders: ReadonlyArray<Provider | EnvironmentProviders> = []
) => {
	const providers: (Provider | EnvironmentProviders)[] = [
		deps.provideServerRendering(),
		deps.provideClientHydration(
			deps.withHttpTransferCacheOptions(
				buildAbsoluteHttpTransferCacheOptions()
			)
		),
		deps.provideZonelessChangeDetection(),
		{ provide: deps.APP_BASE_HREF, useValue: '/' },
		{
			provide: deps.DomSanitizer,
			useValue: sanitizer
		},
		{ provide: deps.Sanitizer, useValue: sanitizer },
		...buildRequestProviders(deps, request, requestContext, responseInit),
		...userProviders
	];

	if (!maybeProps) {
		return providers;
	}

	const propProviders = Object.entries(maybeProps)
		.map(([propName, propValue]) => ({
			token: tokenMap.get(toScreamingSnake(propName)),
			value: propValue
		}))
		.filter((entry) => entry.token)
		.map((entry) => ({ provide: entry.token, useValue: entry.value }));

	return [...providers, ...propProviders];
};
export const clearSelectorCache = () => selectorCache.clear();

const isInjectionToken = (value: unknown) => {
	if (!value || typeof value !== 'object') {
		return false;
	}

	return (
		'ngMetadataName' in value && value.ngMetadataName === 'InjectionToken'
	);
};

export const discoverTokens = (pageModule: Record<string, unknown>) =>
	new Map(
		Object.entries(pageModule).filter(([, value]) =>
			isInjectionToken(value)
		)
	);
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
	props?: Record<string, unknown>
) => {
	let result = html;

	const registeredScripts = getAndClearClientScripts(requestId);
	if (registeredScripts.length > 0) {
		result = injectBeforeClose(
			result,
			generateClientScriptCode(registeredScripts)
		);
	}

	if (props) {
		result = injectBeforeClose(
			result,
			`<script>window.__ABS_ANGULAR_PAGE_PROPS__ = ${JSON.stringify(props)};</script>`
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

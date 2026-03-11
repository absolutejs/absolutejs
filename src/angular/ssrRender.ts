import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import type { BootstrapContext } from '@angular/platform-browser';
import type {
	AngularDeps,
	CachedRouteData,
	SsrDepsResult
} from '../../types/angular';
import { toScreamingSnake } from '../utils/stringModifiers';
import {
	getAndClearClientScripts,
	generateClientScriptCode
} from '../utils/registerClientScript';

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

// --- SSR deps loader ---

export const buildDeps = (
	ssrResult: SsrDepsResult | null,
	baseDeps: AngularDeps
) => {
	if (!ssrResult?.core) {
		return baseDeps;
	}

	const { common, core, platformBrowser, platformServer } = ssrResult;

	return {
		APP_BASE_HREF: common?.APP_BASE_HREF ?? baseDeps.APP_BASE_HREF,
		bootstrapApplication:
			platformBrowser?.bootstrapApplication ??
			baseDeps.bootstrapApplication,
		DomSanitizer: platformBrowser?.DomSanitizer ?? baseDeps.DomSanitizer,
		provideClientHydration:
			platformBrowser?.provideClientHydration ??
			baseDeps.provideClientHydration,
		provideServerRendering:
			platformServer?.provideServerRendering ??
			baseDeps.provideServerRendering,
		provideZonelessChangeDetection: core.provideZonelessChangeDetection,
		reflectComponentType: core.reflectComponentType,
		renderApplication:
			platformServer?.renderApplication ?? baseDeps.renderApplication,
		Sanitizer: core.Sanitizer,
		SecurityContext: core.SecurityContext
	} satisfies AngularDeps;
};
export const buildProviders = (
	deps: AngularDeps,
	sanitizer: InstanceType<AngularDeps['DomSanitizer']>,
	maybeProps: Record<string, unknown> | undefined,
	tokenMap: Map<string, unknown>
) => {
	const providers: (Provider | EnvironmentProviders)[] = [
		deps.provideServerRendering(),
		deps.provideClientHydration(),
		deps.provideZonelessChangeDetection(),
		{ provide: deps.APP_BASE_HREF, useValue: '/' },
		{
			provide: deps.DomSanitizer,
			useValue: sanitizer
		},
		{ provide: deps.Sanitizer, useValue: sanitizer }
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
export const loadSsrDeps = async (pagePath: string) => {
	const ssrDepsPath = (pagePath.split('?')[0] ?? pagePath).replace(
		/\.js$/,
		'.ssr-deps.js'
	);

	try {
		const ssrDeps = await import(ssrDepsPath);

		const result: SsrDepsResult = {
			common: ssrDeps.__angularCommon,
			core: ssrDeps.__angularCore,
			platformBrowser: ssrDeps.__angularPlatformBrowser,
			platformServer: ssrDeps.__angularPlatformServer
		};

		return result;
	} catch {
		return null;
	}
};
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
	indexPath: string
) => {
	let result = html;

	const registeredScripts = getAndClearClientScripts(requestId);
	if (registeredScripts.length > 0) {
		result = injectBeforeClose(
			result,
			generateClientScriptCode(registeredScripts)
		);
	}

	if (indexPath) {
		result = injectBeforeClose(
			result,
			`<script type="module" src="${indexPath}"></script>`
		);
	}

	return result;
};

// --- Render with suppressed dev logs ---

export const renderAngularApp = async (
	deps: AngularDeps,
	PageComponent: Type<unknown>,
	providers: (Provider | EnvironmentProviders)[],
	document: string | Document
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

	const bootstrap = (context: BootstrapContext) =>
		deps.bootstrapApplication(PageComponent, { providers }, context);

	try {
		return await deps.renderApplication(bootstrap, {
			document,
			platformProviders: [],
			url: '/'
		});
	} finally {
		console.log = origLog;
	}
};

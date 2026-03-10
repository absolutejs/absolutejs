import type { Type } from '@angular/core';
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
// Component selectors never change for a given pagePath, so we cache them
// to avoid re-reading ɵcmp metadata / decorator annotations every request.

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
		domino: baseDeps.domino,
		DomSanitizer: platformBrowser?.DomSanitizer ?? baseDeps.DomSanitizer,
		provideClientHydration:
			platformBrowser?.provideClientHydration ??
			baseDeps.provideClientHydration,
		provideServerRendering:
			platformServer?.provideServerRendering ??
			baseDeps.provideServerRendering,
		provideZonelessChangeDetection: core.provideZonelessChangeDetection,
		renderApplication:
			platformServer?.renderApplication ?? baseDeps.renderApplication,
		Sanitizer: core.Sanitizer,
		SecurityContext: core.SecurityContext
	} as AngularDeps;
};
export const loadSsrDeps = async (pagePath: string) => {
	const ssrDepsPath = pagePath
		.split('?')[0]!
		.replace(/\.js$/, '.ssr-deps.js');

	try {
		const ssrDeps = await import(ssrDepsPath);

		return {
			common: ssrDeps.__angularCommon,
			core: ssrDeps.__angularCore,
			platformBrowser: ssrDeps.__angularPlatformBrowser,
			platformServer: ssrDeps.__angularPlatformServer
		} as SsrDepsResult;
	} catch {
		return null;
	}
};

// --- Token discovery ---

const isInjectionToken = (value: unknown) =>
	Boolean(value) &&
	typeof value === 'object' &&
	(value as { ngMetadataName?: string }).ngMetadataName === 'InjectionToken';

export const discoverTokens = (pageModule: Record<string, unknown>) =>
	new Map(
		Object.entries(pageModule).filter(([, value]) =>
			isInjectionToken(value)
		)
	);

// --- Selector resolution ---

const extractSelectorFromAnnotations = (PageComponent: Type<unknown>) => {
	const annotations =
		(PageComponent as any).__annotations__ ||
		(PageComponent as any).decorators?.map((dec: any) => dec.annotation);

	if (!annotations) {
		return undefined;
	}

	for (const ann of annotations) {
		if (ann?.selector) {
			return ann.selector as string;
		}
	}

	return undefined;
};

export const buildProviders = (
	deps: AngularDeps,
	sanitizer: any,
	maybeProps: Record<string, unknown> | undefined,
	tokenMap: Map<string, unknown>
) => {
	const providers: any[] = [
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
export const resolveSelector = (
	pagePath: string,
	PageComponent: Type<unknown>
) => {
	const cached = selectorCache.get(pagePath);
	if (cached) {
		return cached;
	}

	const cmpDef = (PageComponent as any).ɵcmp;
	const selector =
		cmpDef?.selectors?.[0]?.[0] ??
		extractSelectorFromAnnotations(PageComponent) ??
		'ng-app';
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
	providers: any[],
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

	const bootstrap = (context: any) =>
		(
			deps.bootstrapApplication as (
				component: Type<unknown>,
				config?: { providers?: unknown[] },
				context?: any
			) => Promise<unknown>
		)(PageComponent, { providers }, context);

	try {
		return await deps.renderApplication(bootstrap as any, {
			document,
			platformProviders: [],
			url: '/'
		});
	} finally {
		console.log = origLog;
	}
};

import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Type } from '@angular/core';
import type { AngularPageImporter } from '../../types/angular';
import { BASE_36_RADIX, RANDOM_ID_END_INDEX } from '../constants';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import { toScreamingSnake } from '../utils/stringModifiers';
import {
	setSsrContextGetter,
	getAndClearClientScripts,
	generateClientScriptCode
} from '../utils/registerClientScript';

const angularSsrContext = new AsyncLocalStorage<string>();
setSsrContextGetter(() => angularSsrContext.getStore());

// --- Patch Angular injector singleton for HMR compatibility ---
// Bun's --hot mode can create duplicate Angular module instances during
// HMR rebuilds. Angular's _currentInjector is a module-level variable in
// _not_found-chunk.mjs — when duplicated, R3Injector.get() sets it in
// instance A while the factory's inject() reads from instance B (undefined),
// causing NG0203. This patch stores _currentInjector on globalThis so all
// instances share the same value.

const applyInjectorPatch = (chunkPath: string, content: string) => {
	if (content.includes('Symbol.for("angular.currentInjector")')) {
		return;
	}

	const original = [
		'let _currentInjector = undefined;',
		'function getCurrentInjector() {',
		'  return _currentInjector;',
		'}',
		'function setCurrentInjector(injector) {',
		'  const former = _currentInjector;',
		'  _currentInjector = injector;',
		'  return former;',
		'}'
	].join('\n');

	const replacement = [
		'const _injSym = Symbol.for("angular.currentInjector");',
		'if (!globalThis[_injSym]) globalThis[_injSym] = { v: undefined };',
		'function getCurrentInjector() {',
		'  return globalThis[_injSym].v;',
		'}',
		'function setCurrentInjector(injector) {',
		'  const former = globalThis[_injSym].v;',
		'  globalThis[_injSym].v = injector;',
		'  return former;',
		'}'
	].join('\n');

	const patched = content.replace(original, replacement);

	if (patched === content) {
		return;
	}

	writeFileSync(chunkPath, patched, 'utf-8');
};

const patchAngularInjectorSingleton = () => {
	try {
		const coreDir = dirname(require.resolve('@angular/core/package.json'));
		const chunkPath = join(coreDir, 'fesm2022', '_not_found-chunk.mjs');
		const content = readFileSync(chunkPath, 'utf-8');
		applyInjectorPatch(chunkPath, content);
	} catch {
		// Non-fatal — HMR may see NG0203 on second+ edits
	}
};

// Apply immediately at module load so the file is patched before any
// Angular module is first evaluated by Bun's --hot mode or linker plugin.
patchAngularInjectorSingleton();

// --- Module-level lazy singleton for Angular dependencies ---

type AngularDeps = {
	bootstrapApplication: any;
	DomSanitizer: any;
	provideClientHydration: any;
	renderApplication: any;
	provideServerRendering: any;
	APP_BASE_HREF: any;
	provideZonelessChangeDetection: any;
	Sanitizer: any;
	SecurityContext: any;
	domino: {
		createWindow?: (html: string, url: string) => { document: Document };
	} | null;
};

let angularDeps: Promise<AngularDeps> | null = null;

const initDominoAdapter = (platformServer: any) => {
	try {
		const DominoAdapter = platformServer.ɵDominoAdapter as
			| { makeCurrent?: () => void }
			| undefined;
		DominoAdapter?.makeCurrent?.();
	} catch (err) {
		console.error('Failed to initialize DominoAdapter:', err);
	}
};

const patchQuerySelectorAll = (headProto: any) => {
	if (!headProto || typeof headProto.querySelectorAll === 'function') {
		return;
	}

	headProto.querySelectorAll = function (sel: string) {
		const doc = this.ownerDocument;
		if (!doc?.querySelectorAll) {
			return [];
		}

		const all = doc.querySelectorAll(sel);
		const self = this;

		return Array.from(all).filter(
			(elm: any) => elm.parentElement === self || self.contains(elm)
		);
	};
};

const patchQuerySelector = (headProto: any) => {
	if (!headProto || typeof headProto.querySelector === 'function') {
		return;
	}

	headProto.querySelector = function (sel: string) {
		const doc = this.ownerDocument;
		if (!doc?.querySelector) {
			return null;
		}

		const elm = doc.querySelector(sel);
		if (elm && (elm.parentElement === this || this.contains(elm))) {
			return elm;
		}

		return null;
	};
};

const patchDominoPrototype = (domino: NonNullable<AngularDeps['domino']>) => {
	if (!domino.createWindow) {
		return;
	}

	try {
		const probeWin = domino.createWindow('', '/');
		const headProto = Object.getPrototypeOf(probeWin.document.head);
		patchQuerySelectorAll(headProto);
		patchQuerySelector(headProto);
	} catch {
		// Probe failed — per-document polyfills will handle it
	}
};

const loadAngularDeps = async () => {
	// Patch Angular's _currentInjector to use globalThis BEFORE any
	// Angular module is loaded — this prevents NG0203 when Bun's --hot
	// mode creates duplicate module instances during HMR rebuilds.
	patchAngularInjectorSingleton();

	// JIT compiler MUST be fully loaded before any other Angular import.
	// Angular packages like @angular/common contain partially compiled
	// injectables (e.g. PlatformLocation) that need the JIT compiler
	// facade to be registered first.
	await import('@angular/compiler');

	// angularPatch imports @angular/platform-server internally, so it
	// must also run after the compiler is available.
	await import('./angularPatch').then((mod) => mod.patchesApplied);

	// Now safe to load all Angular packages in parallel
	const [platformBrowser, platformServer, common, core, domino] =
		await Promise.all([
			import('@angular/platform-browser'),
			import('@angular/platform-server'),
			import('@angular/common'),
			import('@angular/core'),
			import('domino' as string).catch(() => null) as Promise<{
				createWindow?: (
					html: string,
					url: string
				) => { document: Document };
			} | null>
		]);

	if (process.env.NODE_ENV !== 'development') {
		core.enableProdMode();
	}

	initDominoAdapter(platformServer);

	// Patch domino's head prototype once — these polyfills fix missing
	// DOM APIs that Angular SSR expects (querySelector, querySelectorAll,
	// children). Applied to the prototype so every domino document
	// inherits them automatically.
	if (domino) {
		patchDominoPrototype(domino);
	}

	return {
		APP_BASE_HREF: common.APP_BASE_HREF,
		bootstrapApplication: platformBrowser.bootstrapApplication,
		domino,
		DomSanitizer: platformBrowser.DomSanitizer,
		provideClientHydration: platformBrowser.provideClientHydration,
		provideServerRendering: platformServer.provideServerRendering,
		provideZonelessChangeDetection: core.provideZonelessChangeDetection,
		renderApplication: platformServer.renderApplication,
		Sanitizer: core.Sanitizer,
		SecurityContext: core.SecurityContext
	};
};

const getAngularDeps = () => {
	if (!angularDeps) {
		angularDeps = loadAngularDeps();
	}

	return angularDeps;
};

// --- Module-level SSR Sanitizer ---

const escapeHtml = (str: string) =>
	String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const bypassValue = (value: string) =>
	({ changingThisBreaksApplicationSecurity: value }) as any;

// Deferred: SsrSanitizer class is built after deps load because it
// extends DomSanitizer which comes from the lazy import. We cache the
// class + singleton instance after the first request.
let ssrSanitizer: any = null;

const getSsrSanitizer = (deps: AngularDeps) => {
	if (ssrSanitizer) return ssrSanitizer;

	const SsrSanitizerClass = class extends deps.DomSanitizer {
		sanitize(ctx: any, value: any) {
			if (value == null) return null;
			let strValue: string;
			if (typeof value === 'string') {
				strValue = value;
			} else if (
				typeof value === 'object' &&
				'changingThisBreaksApplicationSecurity' in value
			) {
				strValue = String(value.changingThisBreaksApplicationSecurity);
			} else {
				strValue = String(value);
			}

			if (ctx === deps.SecurityContext?.HTML || ctx === 1) {
				return escapeHtml(strValue);
			}

			return strValue;
		}
		bypassSecurityTrustHtml(value: string) {
			return bypassValue(escapeHtml(value));
		}
		bypassSecurityTrustStyle(value: string) {
			return bypassValue(value);
		}
		bypassSecurityTrustScript(value: string) {
			return bypassValue(value);
		}
		bypassSecurityTrustUrl(value: string) {
			return bypassValue(value);
		}
		bypassSecurityTrustResourceUrl(value: string) {
			return bypassValue(value);
		}
	};

	ssrSanitizer = new SsrSanitizerClass();

	return ssrSanitizer;
};

// --- Domino document creation helper ---

const patchChildren = (head: any) => {
	const elementNodes = Array.from(head.childNodes).filter(
		(node: any) => node.nodeType === 1
	);
	const childrenArray: any[] = [];
	elementNodes.forEach((node, index) => {
		childrenArray[index] = node;
	});
	childrenArray.length = elementNodes.length;
	Object.defineProperty(head, 'children', {
		configurable: false,
		enumerable: true,
		value: childrenArray,
		writable: false
	});
};

const ensureDocHead = (doc: Document) => {
	if (doc.head) {
		return;
	}

	const head = doc.createElement('head');
	if (!doc.documentElement) {
		return;
	}

	doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
};

const patchDocHeadChildren = (doc: Document) => {
	if (!doc.head) {
		return;
	}

	const { children } = doc.head;
	const needsPatch =
		!children ||
		typeof children.length === 'undefined' ||
		(children[0] === undefined && children.length > 0);

	if (needsPatch) {
		patchChildren(doc.head);
	}
};

const createDominoDocument = (
	htmlString: string,
	domino: AngularDeps['domino']
) => {
	if (!domino?.createWindow) return htmlString as string | Document;

	try {
		const win = domino.createWindow(htmlString, '/');
		const doc = win.document;
		ensureDocHead(doc);
		// children is instance-specific (depends on actual child nodes)
		// — must be patched per-document unlike querySelector/querySelectorAll
		// which are patched on the prototype once during init.
		patchDocHeadChildren(doc);

		return doc as string | Document;
	} catch (err) {
		console.error(
			'Failed to parse document with domino, using string:',
			err
		);

		return htmlString as string | Document;
	}
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

// --- Last-used props cache for HMR ---
// Stores { props, headTag } from the most recent real request per route
// so HMR re-renders with the same data the user last saw (Vite/Next behavior).

type CachedRouteData = {
	props: Record<string, unknown> | undefined;
	headTag: `<head>${string}</head>`;
};

const routePropsCache = new Map<string, CachedRouteData>();

export const getCachedRouteData = (pagePath: string) =>
	routePropsCache.get(pagePath);

// --- Selector cache ---
// Component selectors never change for a given pagePath, so we cache them
// to avoid re-reading ɵcmp metadata / decorator annotations every request.

const selectorCache = new Map<string, string>();

// --- SSR deps loader ---

type SsrDepsResult = {
	common: any;
	core: any;
	platformBrowser: any;
	platformServer: any;
};

const loadSsrDeps = async (pagePath: string) => {
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

const buildDeps = (ssrResult: SsrDepsResult | null, baseDeps: AngularDeps) => {
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

// --- Token discovery ---

const isInjectionToken = (value: unknown) =>
	Boolean(value) &&
	typeof value === 'object' &&
	(value as { ngMetadataName?: string }).ngMetadataName === 'InjectionToken';

const discoverTokens = (pageModule: Record<string, unknown>) =>
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

const resolveSelector = (pagePath: string, PageComponent: Type<unknown>) => {
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

// --- Provider building ---

const buildProviders = (
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

// --- Post-render HTML injection ---

const injectSsrScripts = (
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

const renderAngularApp = async (
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

// --- Handler ---

export const handleAngularPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	_importer: AngularPageImporter<Props>,
	pagePath: string,
	indexPath: string,
	headTag: `<head>${string}</head>` = '<head></head>',
	...props: keyof Props extends never ? [] : [props: NoInfer<Props>]
) => {
	const requestId = `angular_${Date.now()}_${Math.random().toString(BASE_36_RADIX).substring(2, RANDOM_ID_END_INDEX)}`;

	return angularSsrContext.run(requestId, async () => {
		try {
			const [maybeProps] = props;

			// Cache props + headTag for HMR replay — strip query strings
			// so cache-busted HMR paths match the original manifest path.
			const cacheKey = pagePath.split('?')[0] ?? pagePath;
			routePropsCache.set(cacheKey, { headTag, props: maybeProps });

			const baseDeps = await getAngularDeps();
			const pageModule = await import(pagePath);
			const PageComponent: Type<unknown> = pageModule.default;

			const ssrResult = await loadSsrDeps(pagePath);
			const deps = buildDeps(ssrResult, baseDeps);

			const tokenMap = discoverTokens(pageModule);
			const selector = resolveSelector(pagePath, PageComponent);

			const htmlString = `<!DOCTYPE html><html>${headTag}<body><${selector}></${selector}></body></html>`;
			const document = createDominoDocument(htmlString, deps.domino);

			if (ssrResult?.core) ssrSanitizer = null;
			const sanitizer = getSsrSanitizer(deps);
			const providers = buildProviders(
				deps,
				sanitizer,
				maybeProps,
				tokenMap
			);

			const rawHtml: string = await renderAngularApp(
				deps,
				PageComponent,
				providers,
				document
			);

			const html = injectSsrScripts(rawHtml, requestId, indexPath);

			return new Response(html, {
				headers: { 'Content-Type': 'text/html' }
			});
		} catch (error) {
			console.error('[SSR] Angular render error:', error);

			return new Response(ssrErrorPage('angular', error), {
				headers: { 'Content-Type': 'text/html' },
				status: 500
			});
		}
	});
};

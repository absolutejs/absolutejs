import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Type } from '@angular/core';
import type { AngularPageImporter } from '../../types/angular';
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

const patchAngularInjectorSingleton = () => {
	try {
		const coreDir = dirname(require.resolve('@angular/core/package.json'));
		const chunkPath = join(coreDir, 'fesm2022', '_not_found-chunk.mjs');
		const content = readFileSync(chunkPath, 'utf-8');

		if (content.includes('Symbol.for("angular.currentInjector")')) {
			return; // Already patched
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

		if (patched !== content) {
			writeFileSync(chunkPath, patched, 'utf-8');
		}
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
	await import('./angularPatch').then((mod) => mod.default);

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

	// Initialize DominoAdapter once
	try {
		const DominoAdapter = (platformServer as any).ɵDominoAdapter as
			| { makeCurrent?: () => void }
			| undefined;
		if (DominoAdapter?.makeCurrent) {
			DominoAdapter.makeCurrent();
		}
	} catch (err) {
		console.error('Failed to initialize DominoAdapter:', err);
	}

	// Patch domino's head prototype once — these polyfills fix missing
	// DOM APIs that Angular SSR expects (querySelector, querySelectorAll,
	// children). Applied to the prototype so every domino document
	// inherits them automatically.
	if (domino?.createWindow) {
		try {
			const probeWin = domino.createWindow('', '/');
			const headProto = Object.getPrototypeOf(probeWin.document.head);

			if (headProto && typeof headProto.querySelectorAll !== 'function') {
				headProto.querySelectorAll = function (sel: string) {
					const doc = this.ownerDocument;
					if (doc?.querySelectorAll) {
						const all = doc.querySelectorAll(sel);
						const self = this;

						return Array.from(all).filter(
							(el: any) =>
								el.parentElement === self || self.contains(el)
						);
					}

					return [];
				};
			}

			if (headProto && typeof headProto.querySelector !== 'function') {
				headProto.querySelector = function (sel: string) {
					const doc = this.ownerDocument;
					if (doc?.querySelector) {
						const el = doc.querySelector(sel);
						if (
							el &&
							(el.parentElement === this || this.contains(el))
						) {
							return el;
						}
					}

					return null;
				};
			}
		} catch {
			// Probe failed — per-document polyfills will handle it
		}
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
		sanitize(ctx: any, value: any): string | null {
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

const createDominoDocument = (
	htmlString: string,
	domino: AngularDeps['domino']
) => {
	if (!domino?.createWindow) return htmlString as string | Document;

	try {
		const win = domino.createWindow(htmlString, '/');
		const doc = win.document;

		if (!doc.head) {
			const head = doc.createElement('head');
			if (doc.documentElement) {
				doc.documentElement.insertBefore(
					head,
					doc.documentElement.firstChild
				);
			}
		}

		// children is instance-specific (depends on actual child nodes)
		// — must be patched per-document unlike querySelector/querySelectorAll
		// which are patched on the prototype once during init.
		if (doc.head) {
			const { children } = doc.head;
			if (
				!children ||
				typeof children.length === 'undefined' ||
				(children[0] === undefined && children.length > 0)
			) {
				patchChildren(doc.head);
			}
		}

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
	const requestId = `angular_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

	return angularSsrContext.run(requestId, async () => {
		try {
			const [maybeProps] = props;

			// Cache props + headTag for HMR replay — strip query strings
			// so cache-busted HMR paths match the original manifest path.
			const cacheKey = pagePath.split('?')[0] ?? pagePath;
			routePropsCache.set(cacheKey, { headTag, props: maybeProps });

			// Load base Angular deps (ensures compiler + patches are initialized)
			const baseDeps = await getAngularDeps();

			// Use dynamic import() with a cache-busting query string to get
			// a fresh module on each request. This avoids bun --hot watching
			// and re-evaluating compiled modules (which caused ~800ms delays
			// on 2nd+ HMR changes). The re-exported Angular deps (__angularCore
			// etc.) guarantee token identity regardless of which module graph
			// the import creates.
			const pageModule = await import(pagePath);
			const PageComponent: Type<unknown> = pageModule.default;

			// Load Angular dep re-exports from the sibling .ssr-deps.js
			// file (written by compileAngular in HMR mode). These are in
			// a separate file to avoid require() calls leaking into the
			// client bundle. Falls back to baseDeps if the file doesn't exist.
			const ssrDepsPath = pagePath
				.split('?')[0]!
				.replace(/\.js$/, '.ssr-deps.js');
			let core: any = null;
			let platformBrowser: any = null;
			let platformServer: any = null;
			let common: any = null;
			try {
				const ssrDeps = await import(ssrDepsPath);
				core = ssrDeps.__angularCore;
				platformBrowser = ssrDeps.__angularPlatformBrowser;
				platformServer = ssrDeps.__angularPlatformServer;
				common = ssrDeps.__angularCommon;
			} catch {
				// No ssr-deps file — use baseDeps (production or first load)
			}

			const deps: AngularDeps = core
				? {
						APP_BASE_HREF:
							common?.APP_BASE_HREF ?? baseDeps.APP_BASE_HREF,
						bootstrapApplication:
							platformBrowser?.bootstrapApplication ??
							baseDeps.bootstrapApplication,
						domino: baseDeps.domino,
						DomSanitizer:
							platformBrowser?.DomSanitizer ??
							baseDeps.DomSanitizer,
						provideClientHydration:
							platformBrowser?.provideClientHydration ??
							baseDeps.provideClientHydration,
						provideServerRendering:
							platformServer?.provideServerRendering ??
							baseDeps.provideServerRendering,
						provideZonelessChangeDetection:
							core.provideZonelessChangeDetection,
						renderApplication:
							platformServer?.renderApplication ??
							baseDeps.renderApplication,
						Sanitizer: core.Sanitizer,
						SecurityContext: core.SecurityContext
					}
				: baseDeps;

			// Auto-discover InjectionToken exports from the module
			const tokenMap = new Map<string, unknown>();
			for (const [exportName, exportValue] of Object.entries(
				pageModule
			)) {
				if (
					exportValue &&
					typeof exportValue === 'object' &&
					(exportValue as { ngMetadataName?: string })
						.ngMetadataName === 'InjectionToken'
				) {
					tokenMap.set(exportName, exportValue);
				}
			}

			// Read selector — cached per pagePath since it never changes
			let selector = selectorCache.get(pagePath);
			if (!selector) {
				const cmpDef = (PageComponent as any).ɵcmp;
				selector = cmpDef?.selectors?.[0]?.[0];
				if (!selector) {
					const annotations =
						(PageComponent as any).__annotations__ ||
						(PageComponent as any).decorators?.map(
							(d: any) => d.annotation
						);
					if (annotations) {
						for (const ann of annotations) {
							if (ann?.selector) {
								selector = ann.selector;
								break;
							}
						}
					}
				}
				selector = selector || 'ng-app';
				selectorCache.set(pagePath, selector);
			}

			const htmlString = `<!DOCTYPE html><html>${headTag}<body><${selector}></${selector}></body></html>`;
			const document = createDominoDocument(htmlString, deps.domino);

			// Build providers — when using re-exported deps (core !== undefined),
			// the DomSanitizer class may differ from the cached one, so we
			// must rebuild the sanitizer to avoid instanceof mismatches.
			if (core) ssrSanitizer = null;
			const sanitizer = getSsrSanitizer(deps);
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

			if (maybeProps) {
				for (const [propName, propValue] of Object.entries(
					maybeProps
				)) {
					const tokenName = toScreamingSnake(propName);
					const token = tokenMap.get(tokenName);
					if (token) {
						providers.push({
							provide: token,
							useValue: propValue
						});
					}
				}
			}

			// Bootstrap + render
			// Suppress Angular's "development mode" console noise during
			// SSR — it's meant for the browser, not server.
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

			let html: string;
			try {
				html = await deps.renderApplication(bootstrap as any, {
					document,
					platformProviders: [],
					url: '/'
				});
			} finally {
				console.log = origLog;
			}

			// Inject client scripts registered during SSR
			const registeredScripts = getAndClearClientScripts(requestId);
			if (registeredScripts.length > 0) {
				html = injectBeforeClose(
					html,
					generateClientScriptCode(registeredScripts)
				);
			}

			// Inject Angular hydration index module script
			if (indexPath) {
				html = injectBeforeClose(
					html,
					`<script type="module" src="${indexPath}"></script>`
				);
			}

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

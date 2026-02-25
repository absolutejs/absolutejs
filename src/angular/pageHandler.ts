import { AsyncLocalStorage } from 'node:async_hooks';
import type { AngularComponent } from '../../types/angular';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import { toScreamingSnake } from '../utils/stringModifiers';
import {
	setSsrContextGetter,
	getAndClearClientScripts,
	generateClientScriptCode
} from '../utils/registerClientScript';

const angularSsrContext = new AsyncLocalStorage<string>();
setSsrContextGetter(() => angularSsrContext.getStore());

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
		bootstrapApplication: platformBrowser.bootstrapApplication,
		DomSanitizer: platformBrowser.DomSanitizer,
		provideClientHydration: platformBrowser.provideClientHydration,
		renderApplication: platformServer.renderApplication,
		provideServerRendering: platformServer.provideServerRendering,
		APP_BASE_HREF: common.APP_BASE_HREF,
		provideZonelessChangeDetection: core.provideZonelessChangeDetection,
		Sanitizer: core.Sanitizer,
		SecurityContext: core.SecurityContext,
		domino
	};
};

const getAngularDeps = () => {
	if (!angularDeps) {
		angularDeps = loadAngularDeps();
	}

	return angularDeps;
};

// --- Module-level SSR Sanitizer ---

const escapeHtml = (str: string) => {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
};

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
		value: childrenArray,
		writable: false,
		enumerable: true,
		configurable: false
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
			const children = doc.head.children;
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
		return html.replace('</body>', snippet + '</body>');
	}
	if (html.includes('</html>')) {
		return html.replace('</html>', snippet + '</html>');
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
	pagePath: string,
	indexPath: string,
	headTag: `<head>${string}</head>` = '<head></head>',
	...props: keyof Props extends never ? [] : [props: Props]
) => {
	const requestId = `angular_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

	return angularSsrContext.run(requestId, async () => {
		try {
			const [maybeProps] = props;

			// Cache props + headTag for HMR replay — strip query strings
			// so cache-busted HMR paths match the original manifest path.
			const cacheKey = pagePath.split('?')[0] ?? pagePath;
			routePropsCache.set(cacheKey, { props: maybeProps, headTag });

			const deps = await getAngularDeps();

			// Dynamic import — pagePath is an absolute path from the manifest
			const pageModule = await import(pagePath);
			const PageComponent: AngularComponent<unknown> = pageModule.default;

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

			// Build providers
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
			const bootstrap = (context: any) =>
				(
					deps.bootstrapApplication as (
						component: AngularComponent<unknown>,
						config?: { providers?: unknown[] },
						context?: any
					) => Promise<unknown>
				)(PageComponent, { providers }, context);

			let html = await deps.renderApplication(bootstrap as any, {
				document,
				url: '/',
				platformProviders: []
			});

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
				status: 500,
				headers: { 'Content-Type': 'text/html' }
			});
		}
	});
};

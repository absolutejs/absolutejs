// CRITICAL: Import patch module FIRST to apply patches at module resolution time
// This ensures patches are applied before Angular SSR modules are loaded
import patchPromise, { createDocumentProxy } from './angularPatch';

// Store original async implementations before zone.js patches them
// This allows us to restore them for Svelte rendering
const originalPromise = Promise;
const originalAsyncFunction = (async () => {}).constructor;

// Import Angular modules (patches are already being applied by angularPatch.ts)
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication, provideServerRendering, INITIAL_CONFIG } from '@angular/platform-server';
import { APP_BASE_HREF } from '@angular/common';
import { InjectionToken } from '@angular/core';

// BootstrapContext exists in Angular 19 but TypeScript definitions may vary
interface BootstrapContext {
	platformRef: any;
}
import { file } from 'bun';
import { ComponentType as ReactComponent, createElement } from 'react';
import { renderToReadableStream as renderReactToReadableStream } from 'react-dom/server';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent, createSSRApp, h } from 'vue';
import { renderToWebStream as renderVueToWebStream } from 'vue/server-renderer';
import { renderToReadableStream as renderSvelteToReadableStream } from '../svelte/renderToReadableStream';
import { renderToString as renderSvelteToString } from '../svelte/renderToString';
import { PropsArgs, AngularPageProps, AngularInjectionTokens, AngularComponentModule, AngularComponent } from '../types';
import { registerClientScript, getAndClearClientScripts, generateClientScriptCode } from '../utils/registerClientScript';

export const handleReactPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	pageComponent: ReactComponent<Props>,
	index: string,
	...props: keyof Props extends never ? [] : [props: Props]
) => {
	const [maybeProps] = props;
	const element =
		maybeProps !== undefined
			? createElement(pageComponent, maybeProps)
			: createElement(pageComponent);

	const stream = await renderReactToReadableStream(element, {
		bootstrapModules: [index],
		bootstrapScriptContent: maybeProps
			? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)}`
			: undefined
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/html' }
	});
};

// Declare overloads matching Svelte’s own component API to preserve correct type inference
type HandleSveltePageRequest = {
	(
		PageComponent: SvelteComponent<Record<string, never>>,
		pagePath: string,
		indexPath: string
	): Promise<Response>;
	<P extends Record<string, unknown>>(
		PageComponent: SvelteComponent<P>,
		pagePath: string,
		indexPath: string,
		props: P
	): Promise<Response>;
};

export const handleSveltePageRequest: HandleSveltePageRequest = async <
	P extends Record<string, unknown>
>(
	_PageComponent: SvelteComponent<P>,
	pagePath: string,
	indexPath: string,
	props?: P
) => {
	// CRITICAL: Run Svelte rendering outside of zone.js context
	// zone.js (loaded for Angular) patches async operations globally and breaks Svelte streams
	// We need to run Svelte in a context that bypasses zone.js patches
	const Zone = (globalThis as any).Zone;
	
	// If zone.js is active, we need to completely bypass it for Svelte
	// zone.js patches Promise, async/await, and streams globally at module load time
	// The solution: Use renderToString instead of renderToReadableStream when zone.js is active
	// This avoids ReadableStream which zone.js patches, causing failures
	if (Zone && Zone.current) {
		// When zone.js is active, use string rendering instead of streaming
		// This completely bypasses zone.js's ReadableStream patches
		const { default: ImportedPageComponent } = await import(pagePath);

		const html = renderSvelteToString(
			ImportedPageComponent,
			props,
			{
				bootstrapModules: indexPath ? [indexPath] : [],
				bootstrapScriptContent: `window.__INITIAL_PROPS__=${JSON.stringify(
					props
				)}`
			}
		);

		return new Response(html, {
			headers: { 'Content-Type': 'text/html' }
		});
	}
	
	// If no zone.js, render normally
	const { default: ImportedPageComponent } = await import(pagePath);

	const stream = await renderSvelteToReadableStream(
		ImportedPageComponent,
		props,
		{
			bootstrapModules: indexPath ? [indexPath] : [],
			bootstrapScriptContent: `window.__INITIAL_PROPS__=${JSON.stringify(
				props
			)}`
		}
	);

	return new Response(stream, {
		headers: { 'Content-Type': 'text/html' }
	});
};

export const handleVuePageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	_PageComponent: VueComponent<Props>,
	pagePath: string,
	indexPath: string,
	headTag: `<head>${string}</head>` = '<head></head>',
	...props: keyof Props extends never ? [] : [props: Props]
) => {
	const [maybeProps] = props;

	const { default: ImportedPageComponent } = await import(pagePath);

	const app = createSSRApp({
		render: () => h(ImportedPageComponent, maybeProps ?? {})
	});

	const bodyStream = renderVueToWebStream(app);

	const head = `<!DOCTYPE html><html>${headTag}<body><div id="root">`;
	const tail = `</div><script>window.__INITIAL_PROPS__=${JSON.stringify(
		maybeProps ?? {}
	)}</script><script type="module" src="${indexPath}"></script></body></html>`;

	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(head);
			const reader = bodyStream.getReader();
			const pumpLoop = () => {
				reader
					.read()
					.then(({ done, value }) =>
						done
							? (controller.enqueue(tail), controller.close())
							: (controller.enqueue(value), pumpLoop())
					)
					.catch((err) => controller.error(err));
			};
			pumpLoop();
		}
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/html' }
	});
};

export const handleAngularPageRequest = async (
	PageComponent: AngularComponent<unknown>,
	indexPath: string,
	props?: AngularPageProps,
	template?: string | Document,
	tokens?: AngularInjectionTokens
) => {
	// Generate a unique request ID for this SSR request
	// This allows components to register client scripts during SSR
	const requestId = `angular_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	
	// Make requestId available globally for components to use during SSR
	// Using type assertion because globalThis typing doesn't include our custom property
	(globalThis as { __absolutejs_requestId?: string }).__absolutejs_requestId = requestId;
	
	// Ensure patches are applied before proceeding
	await patchPromise;
	
	// Get injection tokens - either passed in or try to get from component
	const CSS_PATH_TOKEN = tokens?.CSS_PATH;
	const INITIAL_COUNT_TOKEN = tokens?.INITIAL_COUNT;
	
	// Load zone.js if not already loaded (required for Angular)
	if (!('Zone' in globalThis)) {
		try {
			// zone.js/node doesn't have TypeScript definitions, but it exists at runtime
			await import('zone.js/node' as string);
		} catch {
			// zone.js may not be installed, but Angular will handle the error
		}
	}

	// Initialize Domino adapter - patches are already applied at module load time
	// This ensures Angular SSR's DOM types are available globally
	try {
		const platformServer = await import('@angular/platform-server');
		// DominoAdapter is available at runtime but may not be in TypeScript definitions
		const DominoAdapter = (platformServer as { DominoAdapter?: { makeCurrent?: () => void } }).DominoAdapter;
		if (DominoAdapter?.makeCurrent) {
			DominoAdapter.makeCurrent();
			console.log('✅ DominoAdapter initialized (patches already applied at module load)');
		} else {
			console.warn('⚠️ DominoAdapter.makeCurrent not available');
		}
	} catch (error) {
		console.warn('Failed to initialize DominoAdapter:', error);
	}

	// Use a minimal template that Angular will replace
	// For components with selector 'html', we need a complete HTML structure
	// Angular SSR requires a properly formed HTML document with head and body
	// The component will replace the entire <html> element and its contents
	// Angular SSR's getBaseHref() accesses doc.head.children during initialization
	// We need to ensure the HTML is in a format that Angular SSR can parse correctly
	// Using a very simple, minimal HTML structure that's guaranteed to parse
	const htmlString = template || '<!DOCTYPE html><html><head></head><body></body></html>';

	// WORKAROUND: Parse the document ourselves and pass Document object instead of string
	// This ensures doc.head exists when Angular SSR's getBaseHref() accesses it during initialization
	// Angular SSR's getBaseHref() is called before the document string is parsed, causing the error
	let document: string | Document = htmlString;
	if (typeof htmlString === 'string') {
		try {
			// domino may not be installed in absolutejs, but should be in user's project
			// Using type assertion because domino may not have TypeScript definitions
			const domino = await import('domino' as string).catch(() => null) as {
				createWindow?: (html: string, url: string) => { document: Document };
			} | null;
			if (domino?.createWindow) {
				// Parse the HTML string into a Document object
				// This ensures doc.head exists immediately when Angular SSR accesses it
				const window = domino.createWindow(htmlString, '/');
				const doc = window.document;
				
				// Ensure the document has a proper structure with head
				// This is critical - getBaseHref() accesses doc.head.children
				if (!doc.head) {
					const head = doc.createElement('head');
					if (doc.documentElement) {
						doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
					}
				}
				
				// Ensure head has querySelectorAll and querySelector BEFORE anything else
				// Angular SSR uses these immediately
				if (doc.head && typeof doc.head.querySelectorAll !== 'function') {
					try {
						Object.defineProperty(doc.head, 'querySelectorAll', {
							value: function(selector: string) {
								if (doc.querySelectorAll) {
									const all = doc.querySelectorAll(selector);
									return Array.from(all).filter((el: any) => 
										el.parentElement === doc.head || doc.head.contains(el)
									);
								}
								return [];
							},
							writable: true,
							enumerable: false,
							configurable: true
						});
					} catch (e) {
						console.warn('Failed to add querySelectorAll to head:', e);
					}
				}
				if (doc.head && typeof doc.head.querySelector !== 'function') {
					try {
						Object.defineProperty(doc.head, 'querySelector', {
							value: function(selector: string) {
								if (doc.querySelector) {
									const el = doc.querySelector(selector);
									if (el && (el.parentElement === doc.head || doc.head.contains(el))) {
										return el;
									}
								}
								return null;
							},
							writable: true,
							enumerable: false,
							configurable: true
						});
					} catch (e) {
						console.warn('Failed to add querySelector to head:', e);
					}
				}
				
				// Ensure head has children property that works with Angular SSR's getBaseHref()
				// getBaseHref() does: const length = doc.head.children.length;
				// Then iterates: for (let i = 0; i < length; i++) { const child = doc.head.children[i]; }
				// So children needs to be array-like with length and numeric indices
				if (!doc.head.children) {
					// Create a proper HTMLCollection-like object
					const elementNodes = Array.from(doc.head.childNodes).filter((node: any) => node.nodeType === 1);
					const childrenArray: any[] = [];
					elementNodes.forEach((node, index) => {
						childrenArray[index] = node;
					});
					childrenArray.length = elementNodes.length;
					Object.defineProperty(doc.head, 'children', {
						value: childrenArray,
						writable: false,
						enumerable: true,
						configurable: false
					});
				} else {
					// Ensure children has proper array-like structure
					// Domino's children might not be directly indexable
					const children = doc.head.children;
					if (typeof children.length === 'undefined' || children[0] === undefined && children.length > 0) {
						// Rebuild as proper array
						const elementNodes = Array.from(doc.head.childNodes).filter((node: any) => node.nodeType === 1);
						const childrenArray: any[] = [];
						elementNodes.forEach((node, index) => {
							childrenArray[index] = node;
						});
						childrenArray.length = elementNodes.length;
						Object.defineProperty(doc.head, 'children', {
							value: childrenArray,
							writable: false,
							enumerable: true,
							configurable: false
						});
					}
				}
				
				// CRITICAL: Wrap Document in Proxy to intercept property access at engine level
				// This catches doc.head.children access before Angular SSR's getBaseHref() throws
				// The Proxy will safely handle null head or undefined children
				document = createDocumentProxy(doc);
			}
		} catch (error) {
			// If domino parsing fails, fall back to string
			// Angular SSR will parse it internally (but may still have the head issue)
			console.warn('Failed to parse document with domino, using string:', error);
			document = htmlString;
		}
	}

	// Build providers array
	const providers: any[] = [
		provideServerRendering(),  // Essential SSR providers
		{ provide: APP_BASE_HREF, useValue: '/' }  // Base href for routing
	];
	
	// Add prop providers if props and tokens are provided
	if (props) {
		// Debug: Log props being passed
		console.log('🔍 [DEBUG] handleAngularPageRequest props:', props);
		
		if (props.cssPath !== undefined && CSS_PATH_TOKEN) {
			providers.push({
				provide: CSS_PATH_TOKEN,
				useValue: props.cssPath
			});
			console.log('🔍 [DEBUG] Providing cssPath via DI token:', props.cssPath, 'Token:', CSS_PATH_TOKEN);
		} else if (props.cssPath !== undefined) {
			console.warn('⚠️ [DEBUG] cssPath provided but CSS_PATH_TOKEN not available');
		}
		
		if (props.initialCount !== undefined && INITIAL_COUNT_TOKEN) {
			providers.push({
				provide: INITIAL_COUNT_TOKEN,
				useValue: props.initialCount
			});
		}
	}
	
	// Angular 19 SSR pattern: Bootstrap function receives BootstrapContext
	// BootstrapContext is available in Angular 19 and 20.3+
	const bootstrap = (context: BootstrapContext) => {
		// bootstrapApplication signature varies by Angular version, so we need type assertion
		// In Angular 19, it accepts (component, config, context)
		return (bootstrapApplication as (
			component: AngularComponent<unknown>,
			config?: { providers?: unknown[] },
			context?: BootstrapContext
		) => Promise<unknown>)(PageComponent, {
			providers: providers
		}, context);
	};

	try {
		// Convert Document object back to string if needed, but ensure it has proper structure
		let finalDocument: string | Document = document;
		if (typeof document !== 'string' && document) {
			// Wrap Document object in Proxy to intercept property access at engine level
			// This catches doc.head.children access before it throws
			finalDocument = createDocumentProxy(document);
		}
		
		let html = await renderApplication(bootstrap as any, {
			document: finalDocument,
			url: '/',
			platformProviders: []  // Per-request platform-level providers
		});

		// Collect all client scripts registered during SSR by components
		const registeredScripts = getAndClearClientScripts(requestId);
		
		// Generate and inject client scripts if any were registered
		if (registeredScripts.length > 0) {
			const clientScriptCode = generateClientScriptCode(registeredScripts);
			
			// Inject script before closing </body> tag, or before </html> if no body
			if (html.includes('</body>')) {
				html = html.replace('</body>', clientScriptCode + '</body>');
			} else if (html.includes('</html>')) {
				html = html.replace('</html>', clientScriptCode + '</html>');
			} else {
				// Fallback: append to end
				html += clientScriptCode;
			}
		}
		
		// Clean up global request ID
		delete (globalThis as { __absolutejs_requestId?: string }).__absolutejs_requestId;

		return new Response(html, {
			headers: { 'Content-Type': 'text/html' }
		});
	} catch (error: any) {
		// If there's an error with doc.head, it means Angular SSR's DOM parsing failed
		// This is likely a compatibility issue with Bun's environment
		console.error('🚨 [ANGULAR SSR] Error caught in handleAngularPageRequest:', {
			message: error.message,
			stack: error.stack,
			name: error.name,
			error: error
		});
		
		// If the error is about doc.head.children, include detailed information
		if (error.message && error.message.includes('doc.head.children')) {
			console.error('🚨 [ANGULAR SSR] doc.head.children error detected!', {
				fullError: error,
				stack: error.stack,
				message: error.message
			});
		}
		
		throw error;
	}
};

export const handleHTMLPageRequest = (html: string) => file(html);
export const handleHTMXPageRequest = (htmx: string) => file(htmx);

export const handlePageRequest = <Component>(
	PageComponent: Component,
	...props: PropsArgs<Component>
) => {
	console.log('handlePageRequest coming soon.', PageComponent, props);
};

import { file } from 'bun';
import { ComponentType as ReactComponent, createElement } from 'react';
import { renderToReadableStream as renderReactToReadableStream } from 'react-dom/server';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent, createSSRApp, h } from 'vue';
import { renderToWebStream as renderVueToWebStream } from 'vue/server-renderer';
import { renderToReadableStream as renderSvelteToReadableStream } from '../svelte/renderToReadableStream';
import type {
	AngularComponent,
	AngularInjectionTokens,
	AngularPageProps,
	PropsArgs
} from '../../types/build';
import { ssrErrorPage } from '../utils/ssrErrorPage';

export const handleReactPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	PageComponent: ReactComponent<Props>,
	index: string,
	...props: keyof Props extends never ? [] : [props: Props]
) => {
	try {
		const [maybeProps] = props;
		const element =
			maybeProps !== undefined
				? createElement(PageComponent, maybeProps)
				: createElement(PageComponent);

		const stream = await renderReactToReadableStream(element, {
			bootstrapModules: [index],
			bootstrapScriptContent: maybeProps
				? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)}`
				: undefined,
			onError(error: unknown) {
				console.error('[SSR] React streaming error:', error);
			}
		});

		return new Response(stream, {
			headers: { 'Content-Type': 'text/html' }
		});
	} catch (error) {
		console.error('[SSR] React render error:', error);

		return new Response(ssrErrorPage('react', error), {
			status: 500,
			headers: { 'Content-Type': 'text/html' }
		});
	}
};

// Declare overloads matching Svelte's own component API to preserve correct type inference
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
	try {
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
	} catch (error) {
		console.error('[SSR] Svelte render error:', error);

		return new Response(ssrErrorPage('svelte', error), {
			status: 500,
			headers: { 'Content-Type': 'text/html' }
		});
	}
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
	try {
		const [maybeProps] = props;

		const { default: ImportedPageComponent } = await import(pagePath);

		const app = createSSRApp({
			render: () => h(ImportedPageComponent, maybeProps ?? null)
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
	} catch (error) {
		console.error('[SSR] Vue render error:', error);

		return new Response(ssrErrorPage('vue', error), {
			status: 500,
			headers: { 'Content-Type': 'text/html' }
		});
	}
};

export const handleAngularPageRequest = async (
	PageComponent: AngularComponent<unknown>,
	indexPath: string,
	props?: AngularPageProps,
	template?: string | Document,
	tokens?: AngularInjectionTokens
) => {
	try {
		// Lazy-load Angular deps — only when this handler is actually called
		const [
			angularPatchModule,
			{ bootstrapApplication },
			{ renderApplication, provideServerRendering, INITIAL_CONFIG },
			{ APP_BASE_HREF }
		] = await Promise.all([
			import('./angularPatch'),
			import('@angular/platform-browser'),
			import('@angular/platform-server'),
			import('@angular/common')
		]);

		const { createDocumentProxy } = angularPatchModule;

		// Ensure patches are applied
		await angularPatchModule.default;

		// Generate a unique request ID for this SSR request
		const requestId = `angular_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		// Make requestId available globally for components to use during SSR
		(globalThis as { __absolutejs_requestId?: string }).__absolutejs_requestId =
			requestId;

		// Lazy-load registerClientScript utilities
		const {
			getAndClearClientScripts,
			generateClientScriptCode
		} = await import('../utils/registerClientScript');

		// Get injection tokens
		const CSS_PATH_TOKEN = tokens?.CSS_PATH;
		const INITIAL_COUNT_TOKEN = tokens?.INITIAL_COUNT;

		// Load zone.js if not already loaded (required for Angular)
		if (!('Zone' in globalThis)) {
			try {
				await import('zone.js/node' as string);
			} catch {
				// zone.js may not be installed
			}
		}

		// Initialize Domino adapter
		try {
			const platformServer = await import(
				'@angular/platform-server'
			);
			const DominoAdapter = (
				platformServer as {
					DominoAdapter?: {
						makeCurrent?: () => void;
					};
				}
			).DominoAdapter;
			if (DominoAdapter?.makeCurrent) {
				DominoAdapter.makeCurrent();
			}
		} catch (error) {
			console.error(
				'Failed to initialize DominoAdapter:',
				error
			);
		}

		const htmlString =
			template ||
			'<!DOCTYPE html><html><head></head><body></body></html>';

		// Parse with domino to ensure doc.head exists when Angular SSR accesses it
		let document: string | Document = htmlString as
			| string
			| Document;
		if (typeof htmlString === 'string') {
			try {
				const domino = (await import(
					'domino' as string
				).catch(() => null)) as {
					createWindow?: (
						html: string,
						url: string
					) => { document: Document };
				} | null;
				if (domino?.createWindow) {
					const window = domino.createWindow(
						htmlString,
						'/'
					);
					const doc = window.document;

					if (!doc.head) {
						const head = doc.createElement('head');
						if (doc.documentElement) {
							doc.documentElement.insertBefore(
								head,
								doc.documentElement.firstChild
							);
						}
					}

					// Ensure head has querySelectorAll/querySelector
					if (
						doc.head &&
						typeof doc.head.querySelectorAll !==
							'function'
					) {
						try {
							Object.defineProperty(
								doc.head,
								'querySelectorAll',
								{
									value: (
										selector: string
									) => {
										if (
											doc.querySelectorAll
										) {
											const all =
												doc.querySelectorAll(
													selector
												);

											return Array.from(
												all
											).filter(
												(el: any) =>
													el.parentElement ===
														doc.head ||
													doc.head.contains(
														el
													)
											);
										}

										return [];
									},
									writable: true,
									enumerable: false,
									configurable: true
								}
							);
						} catch {
							// Property may be read-only
						}
					}
					if (
						doc.head &&
						typeof doc.head.querySelector !==
							'function'
					) {
						try {
							Object.defineProperty(
								doc.head,
								'querySelector',
								{
									value: (
										selector: string
									) => {
										if (doc.querySelector) {
											const el =
												doc.querySelector(
													selector
												);
											if (
												el &&
												(el.parentElement ===
													doc.head ||
													doc.head.contains(
														el
													))
											) {
												return el;
											}
										}

										return null;
									},
									writable: true,
									enumerable: false,
									configurable: true
								}
							);
						} catch {
							// Property may be read-only
						}
					}

					// Ensure head has children property
					if (!doc.head.children) {
						const elementNodes = Array.from(
							doc.head.childNodes
						).filter(
							(node: any) => node.nodeType === 1
						);
						const childrenArray: any[] = [];
						elementNodes.forEach((node, index) => {
							childrenArray[index] = node;
						});
						childrenArray.length =
							elementNodes.length;
						Object.defineProperty(
							doc.head,
							'children',
							{
								value: childrenArray,
								writable: false,
								enumerable: true,
								configurable: false
							}
						);
					} else {
						const children = doc.head.children;
						if (
							typeof children.length ===
								'undefined' ||
							(children[0] === undefined &&
								children.length > 0)
						) {
							const elementNodes = Array.from(
								doc.head.childNodes
							).filter(
								(node: any) =>
									node.nodeType === 1
							);
							const childrenArray: any[] = [];
							elementNodes.forEach(
								(node, index) => {
									childrenArray[index] =
										node;
								}
							);
							childrenArray.length =
								elementNodes.length;
							Object.defineProperty(
								doc.head,
								'children',
								{
									value: childrenArray,
									writable: false,
									enumerable: true,
									configurable: false
								}
							);
						}
					}

					document = createDocumentProxy(doc);
				}
			} catch (error) {
				console.error(
					'Failed to parse document with domino, using string:',
					error
				);
				document = htmlString;
			}
		}

		// Build providers array
		const providers: any[] = [
			provideServerRendering(),
			{ provide: APP_BASE_HREF, useValue: '/' }
		];

		if (props) {
			if (
				props.cssPath !== undefined &&
				CSS_PATH_TOKEN
			) {
				providers.push({
					provide: CSS_PATH_TOKEN,
					useValue: props.cssPath
				});
			}

			if (
				props.initialCount !== undefined &&
				INITIAL_COUNT_TOKEN
			) {
				providers.push({
					provide: INITIAL_COUNT_TOKEN,
					useValue: props.initialCount
				});
			}
		}

		// Bootstrap function for Angular SSR
		const bootstrap = (context: any) =>
			(
				bootstrapApplication as (
					component: AngularComponent<unknown>,
					config?: { providers?: unknown[] },
					context?: any
				) => Promise<unknown>
			)(
				PageComponent,
				{ providers },
				context
			);

		// Convert Document object to proxy if needed
		let finalDocument: string | Document = document;
		if (
			typeof document !== 'string' &&
			document
		) {
			finalDocument = createDocumentProxy(document);
		}

		let html = await renderApplication(
			bootstrap as any,
			{
				document: finalDocument,
				url: '/',
				platformProviders: []
			}
		);

		// Collect and inject client scripts registered during SSR
		const registeredScripts =
			getAndClearClientScripts(requestId);

		if (registeredScripts.length > 0) {
			const clientScriptCode =
				generateClientScriptCode(registeredScripts);

			if (html.includes('</body>')) {
				html = html.replace(
					'</body>',
					clientScriptCode + '</body>'
				);
			} else if (html.includes('</html>')) {
				html = html.replace(
					'</html>',
					clientScriptCode + '</html>'
				);
			} else {
				html += clientScriptCode;
			}
		}

		// Clean up global request ID
		delete (
			globalThis as {
				__absolutejs_requestId?: string;
			}
		).__absolutejs_requestId;

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
};

export const handleHTMLPageRequest = (pagePath: string) => file(pagePath);

export const handleHTMXPageRequest = (pagePath: string) => file(pagePath);

export const handlePageRequest = <Component>(
	PageComponent: Component,
	...props: PropsArgs<Component>
) => {
	console.log('handlePageRequest coming soon.', PageComponent, props);
};

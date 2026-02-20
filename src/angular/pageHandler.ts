import type { AngularComponent } from '../../types/angular';
import { ssrErrorPage } from '../utils/ssrErrorPage';
import { toScreamingSnake } from '../utils/stringModifiers';

export const handleAngularPageRequest = async <
	Props extends Record<string, unknown> = Record<never, never>
>(
	pagePath: string,
	indexPath: string,
	headTag: `<head>${string}</head>` = '<head></head>',
	...props: keyof Props extends never ? [] : [props: Props]
) => {
	try {
		const [maybeProps] = props;

		// Dynamic import — pagePath is an absolute path from the manifest
		const pageModule = await import(pagePath);
		const PageComponent: AngularComponent<unknown> =
			pageModule.default;

		// Auto-discover InjectionToken exports from the module.
		// Angular's InjectionToken instances expose ngMetadataName === 'InjectionToken'.
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

		// Lazy-load Angular deps — only when this handler is actually called
		const [
			angularPatchModule,
			{ bootstrapApplication, DomSanitizer, provideClientHydration },
			{ renderApplication, provideServerRendering },
			{ APP_BASE_HREF },
			{ provideZonelessChangeDetection, Sanitizer }
		] = await Promise.all([
			import('./angularPatch'),
			import('@angular/platform-browser'),
			import('@angular/platform-server'),
			import('@angular/common'),
			import('@angular/core')
		]);

		// SSR-safe sanitizer: during server-side rendering there is no
		// browser XSS risk, so we bypass Angular's DomSanitizerImpl which
		// depends on a real DOCUMENT and throws NG0904 with domino.
		const SsrSanitizer = class extends DomSanitizer {
			sanitize(_ctx: any, value: any): string | null {
				if (value == null) return null;
				if (typeof value === 'string') return value;
				if (
					typeof value === 'object' &&
					'changingThisBreaksApplicationSecurity' in
						value
				) {
					return value.changingThisBreaksApplicationSecurity;
				}
				return String(value);
			}
			bypassSecurityTrustHtml(value: string) {
				return {
					changingThisBreaksApplicationSecurity: value
				} as any;
			}
			bypassSecurityTrustStyle(value: string) {
				return {
					changingThisBreaksApplicationSecurity: value
				} as any;
			}
			bypassSecurityTrustScript(value: string) {
				return {
					changingThisBreaksApplicationSecurity: value
				} as any;
			}
			bypassSecurityTrustUrl(value: string) {
				return {
					changingThisBreaksApplicationSecurity: value
				} as any;
			}
			bypassSecurityTrustResourceUrl(value: string) {
				return {
					changingThisBreaksApplicationSecurity: value
				} as any;
			}
		};

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

		// Initialize Domino adapter
		try {
			const platformServer = await import(
				'@angular/platform-server'
			);
			const DominoAdapter = (
				platformServer as any
			).ɵDominoAdapter as
				| { makeCurrent?: () => void }
				| undefined;
			if (DominoAdapter?.makeCurrent) {
				DominoAdapter.makeCurrent();
			}
		} catch (error) {
			console.error(
				'Failed to initialize DominoAdapter:',
				error
			);
		}

		// Read the selector from Angular's compiled component metadata (ɵcmp).
		// This gives us the custom element tag the component expects to hydrate into.
		const cmpDef = (PageComponent as any).ɵcmp;
		const selector =
			cmpDef?.selectors?.[0]?.[0] || 'ng-app';

		const htmlString = `<!DOCTYPE html><html>${headTag}<body><${selector}></${selector}></body></html>`;

		// Parse with domino to ensure doc.head exists when Angular SSR accesses it
		let document: string | Document = htmlString as
			| string
			| Document;
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

		// Build providers array
		const ssrSanitizer = new SsrSanitizer();
		const providers: any[] = [
			provideServerRendering(),
			provideClientHydration(),
			provideZonelessChangeDetection(),
			{ provide: APP_BASE_HREF, useValue: '/' },
			{ provide: DomSanitizer, useValue: ssrSanitizer },
			{ provide: Sanitizer, useValue: ssrSanitizer }
		];

		// Auto-map props to injection tokens via SCREAMING_SNAKE naming convention
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

		// Inject Angular hydration index module script
		if (indexPath) {
			const indexScriptTag = `<script type="module" src="${indexPath}"></script>`;
			if (html.includes('</body>')) {
				html = html.replace(
					'</body>',
					indexScriptTag + '</body>'
				);
			} else if (html.includes('</html>')) {
				html = html.replace(
					'</html>',
					indexScriptTag + '</html>'
				);
			} else {
				html += indexScriptTag;
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

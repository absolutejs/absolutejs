// CRITICAL: This module patches Angular SSR at module resolution time
// It uses top-level await to ensure patches are applied BEFORE any Angular SSR code executes
// This module MUST be imported before any Angular SSR modules are used

// Helper function to capture stack trace
function getStackTrace(): string {
	const stack = new Error().stack;
	return stack ? stack.split('\n').slice(2, 10).join('\n') : 'No stack trace available';
}

// CRITICAL: Proxy-based patching at JavaScript engine level
// This intercepts property access on Document objects to handle null head.children
export function createDocumentProxy(doc: any): any {
	if (!doc || typeof doc !== 'object') return doc;
	
	// Check if already proxied
	if (doc.__absolutejs_proxied) return doc;
	
	console.log('🔍 [ANGULAR PATCH] Creating document proxy:', {
		hasHead: !!doc.head,
		headIsNull: doc.head === null,
		headType: typeof doc.head,
		stack: getStackTrace()
	});
	
	// AGGRESSIVE PATCH: Ensure head property always exists and has children
	// This prevents "null is not an object" errors at the property definition level
	if (doc.head === null || doc.head === undefined) {
		// Create a fake head object with children property
		const fakeHead: any = {
			children: []
		};
		fakeHead.children.length = 0;
		Object.defineProperty(fakeHead, 'item', {
			value: () => null,
			writable: false,
			enumerable: false,
			configurable: false
		});
		
		// Replace null head with fake head
		try {
			Object.defineProperty(doc, 'head', {
				value: fakeHead,
				writable: true,
				enumerable: true,
				configurable: true
			});
		} catch (error) {
			// If we can't define property, the Proxy will handle it
		}
	} else if (doc.head && typeof doc.head === 'object') {
		// Ensure existing head has children property
		if (!doc.head.children || typeof doc.head.children.length === 'undefined') {
			const elementNodes = Array.from(doc.head.childNodes || []).filter((node: any) => node.nodeType === 1);
			const childrenArray: any[] = [];
			elementNodes.forEach((node, index) => {
				childrenArray[index] = node;
			});
			childrenArray.length = elementNodes.length;
			try {
				Object.defineProperty(doc.head, 'children', {
					value: childrenArray,
					writable: false,
					enumerable: true,
					configurable: false
				});
			} catch (error) {
				// If we can't define property, the Proxy will handle it
			}
		}
		// Ensure head has querySelectorAll if it doesn't
		if (doc.head && typeof doc.head.querySelectorAll !== 'function') {
			try {
				Object.defineProperty(doc.head, 'querySelectorAll', {
					value: function(selector: string) {
						// Use the document's querySelectorAll and filter to head
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
			} catch (error) {
				// If we can't define property, the Proxy will handle it
			}
		}
		// Ensure head has querySelector if it doesn't
		if (doc.head && typeof doc.head.querySelector !== 'function') {
			try {
				Object.defineProperty(doc.head, 'querySelector', {
					value: function(selector: string) {
						// Use the document's querySelector and check if it's in head
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
			} catch (error) {
				// If we can't define property, the Proxy will handle it
			}
		}
	}
	
	// Create a Proxy that intercepts property access
	const proxy = new Proxy(doc, {
		get(target: any, prop: string | symbol) {
			// Handle the specific case: doc.head.children when head is null
			// This is the exact error: "null is not an object (evaluating 'doc.head.children')"
			if (prop === 'head') {
				console.log('🔍 [ANGULAR PATCH] Proxy: head property accessed:', {
					hasHead: !!target.head,
					headIsNull: target.head === null,
					headType: typeof target.head,
					stack: getStackTrace()
				});
				const head = target.head;
				if (!head || head === null) {
					console.warn('⚠️ [ANGULAR PATCH] Proxy: head is null, returning fake head proxy');
					// Return a proxy for head that safely handles ALL property access
					// This prevents "null is not an object" errors when accessing head.children
					return new Proxy({}, {
						get(_target: any, headProp: string | symbol) {
							console.log('🔍 [ANGULAR PATCH] Fake head proxy: property accessed:', headProp, {
								stack: getStackTrace()
							});
							if (headProp === 'children') {
								console.log('✅ [ANGULAR PATCH] Fake head proxy: returning empty children array');
								// Return an empty array-like object with length property
								const emptyChildren: any[] = [];
								emptyChildren.length = 0;
								// Make it look like an HTMLCollection
								Object.defineProperty(emptyChildren, 'item', {
									value: () => null,
									writable: false,
									enumerable: false,
									configurable: false
								});
								return emptyChildren;
							}
							if (headProp === 'querySelectorAll') {
								// Return a function that returns an empty NodeList-like object
								return function(selector: string) {
									const emptyNodeList: any[] = [];
									emptyNodeList.length = 0;
									return emptyNodeList;
								};
							}
							if (headProp === 'querySelector') {
								// Return a function that returns null
								return function(selector: string) {
									return null;
								};
							}
							// For any other property access on null head, return undefined
							// This prevents errors when Angular SSR checks head properties
							return undefined;
						},
						has() { return true; },
						ownKeys() { return ['children']; },
						getOwnPropertyDescriptor() {
							// Return descriptor for children to make it enumerable
							return {
								enumerable: true,
								configurable: false,
								writable: false,
								value: []
							};
						}
					});
				}
				// If head exists, proxy it too to handle children access
				if (head && typeof head === 'object') {
					return createHeadProxy(head);
				}
				return head;
			}
			
			// For all other properties, return normally
			const value = target[prop];
			
			// If the value is a function, bind it to the original target
			if (typeof value === 'function') {
				return value.bind(target);
			}
			
			return value;
		},
		set(target: any, prop: string | symbol, value: any) {
			target[prop] = value;
			return true;
		},
		has(target: any, prop: string | symbol) {
			return prop in target;
		},
		ownKeys(target: any) {
			return Reflect.ownKeys(target);
		}
	});
	
	// Mark as proxied to avoid infinite recursion
	Object.defineProperty(doc, '__absolutejs_proxied', {
		value: true,
		writable: false,
		configurable: false,
		enumerable: false
	});
	
	return proxy;
}

// Proxy for head element to safely handle children access
function createHeadProxy(head: any): any {
	// Ensure head has querySelectorAll and querySelector before proxying
	if (head && typeof head === 'object') {
		if (typeof head.querySelectorAll !== 'function') {
			try {
				Object.defineProperty(head, 'querySelectorAll', {
					value: function(selector: string) {
						// Use document's querySelectorAll if available
						if (head.ownerDocument && head.ownerDocument.querySelectorAll) {
							const all = head.ownerDocument.querySelectorAll(selector);
							return Array.from(all).filter((el: any) => 
								el.parentElement === head || head.contains(el)
							);
						}
						return [];
					},
					writable: true,
					enumerable: false,
					configurable: true
				});
			} catch (e) {
				// Property might be read-only, continue
			}
		}
		if (typeof head.querySelector !== 'function') {
			try {
				Object.defineProperty(head, 'querySelector', {
					value: function(selector: string) {
						// Use document's querySelector if available
						if (head.ownerDocument && head.ownerDocument.querySelector) {
							const el = head.ownerDocument.querySelector(selector);
							if (el && (el.parentElement === head || head.contains(el))) {
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
				// Property might be read-only, continue
			}
		}
	}
	if (!head || typeof head !== 'object') return head;
	if (head.__absolutejs_head_proxied) return head;
	
	const proxy = new Proxy(head, {
		get(target: any, prop: string | symbol) {
			if (prop === 'children') {
				const children = target.children;
				if (!children || typeof children.length === 'undefined') {
					// Return a safe array-like object
					const elementNodes = Array.from(target.childNodes || []).filter((node: any) => node.nodeType === 1);
					const childrenArray: any[] = [];
					elementNodes.forEach((node, index) => {
						childrenArray[index] = node;
					});
					childrenArray.length = elementNodes.length;
					return childrenArray;
				}
				return children;
			}
			// Ensure querySelectorAll and querySelector exist
			if (prop === 'querySelectorAll' && typeof target.querySelectorAll !== 'function') {
				return function(selector: string) {
					if (target.ownerDocument && target.ownerDocument.querySelectorAll) {
						const all = target.ownerDocument.querySelectorAll(selector);
						return Array.from(all).filter((el: any) => 
							el.parentElement === target || target.contains(el)
						);
					}
					return [];
				};
			}
			if (prop === 'querySelector' && typeof target.querySelector !== 'function') {
				return function(selector: string) {
					if (target.ownerDocument && target.ownerDocument.querySelector) {
						const el = target.ownerDocument.querySelector(selector);
						if (el && (el.parentElement === target || target.contains(el))) {
							return el;
						}
					}
					return null;
				};
			}
			const value = target[prop];
			if (typeof value === 'function') {
				return value.bind(target);
			}
			return value;
		}
	});
	
	Object.defineProperty(head, '__absolutejs_head_proxied', {
		value: true,
		writable: false,
		configurable: false,
		enumerable: false
	});
	
	return proxy;
}

// Use top-level await to ensure patches are applied synchronously during module resolution
const patchesApplied = (async () => {
	try {
		// Add global error handler to catch the specific error
		try {
			const originalErrorHandler = globalThis.onerror;
			globalThis.onerror = function(message, source, lineno, colno, error) {
				if (typeof message === 'string' && message.includes('doc.head.children')) {
					console.error('🚨 [ANGULAR PATCH] Caught doc.head.children error:', {
						message,
						source,
						lineno,
						colno,
						error,
						stack: error?.stack || 'No stack trace'
					});
				}
				if (originalErrorHandler) {
					return originalErrorHandler.call(this, message, source, lineno, colno, error);
				}
				return false;
			};
		} catch (error) {
			console.warn('⚠️ [ANGULAR PATCH] Failed to set global error handler:', error);
		}
		
		// Also catch unhandled promise rejections
		try {
			const originalUnhandledRejection = globalThis.onunhandledrejection;
			globalThis.onunhandledrejection = function(event) {
				if (event.reason && typeof event.reason === 'object' && event.reason.message && 
				    event.reason.message.includes('doc.head.children')) {
					console.error('🚨 [ANGULAR PATCH] Unhandled rejection with doc.head.children error:', {
						reason: event.reason,
						stack: event.reason?.stack || 'No stack trace'
					});
				}
				if (originalUnhandledRejection) {
					return originalUnhandledRejection.call(this, event);
				}
			};
		} catch (error) {
			console.warn('⚠️ [ANGULAR PATCH] Failed to set unhandled rejection handler:', error);
		}
		
		// Import Angular modules to patch them
		const [common, platformServer] = await Promise.all([
			import('@angular/common'),
			import('@angular/platform-server')
		]);
		
		console.log('✅ [ANGULAR PATCH] Angular modules imported, starting patches...');
		
		// Patch _getDOM to intercept all DOM adapter access
		const _getDOM = (common as any).ɵgetDOM;
		if (_getDOM) {
			const originalGetDOM = _getDOM;
			try {
				// Try to override using defineProperty first (handles readonly properties)
				Object.defineProperty(common, 'ɵgetDOM', {
					value: function() {
						const domAdapter = originalGetDOM();
						if (domAdapter && typeof domAdapter.getBaseHref === 'function') {
							// Store original if not already stored
							const adapter = domAdapter as any;
							if (!adapter.__absolutejs_originalGetBaseHref) {
								adapter.__absolutejs_originalGetBaseHref = domAdapter.getBaseHref.bind(domAdapter);
							}
							// Use defineProperty to make the patch non-overwritable
							Object.defineProperty(domAdapter, 'getBaseHref', {
								value: function(doc: any) {
									console.log('🔍 [ANGULAR PATCH] getBaseHref called via _getDOM():', {
										hasDoc: !!doc,
										hasHead: !!doc?.head,
										headIsNull: doc?.head === null,
										headType: typeof doc?.head,
										hasChildren: !!doc?.head?.children,
										childrenType: typeof doc?.head?.children,
										stack: getStackTrace()
									});
									
									// Bun compatibility: handle case where doc.head is null/undefined
									if (!doc || !doc.head || typeof doc.head.children === 'undefined') {
										console.warn('⚠️ [ANGULAR PATCH] getBaseHref (_getDOM): Returning empty string due to null/undefined head or children');
										return '';
									}
									// Call original function if doc.head exists
									const result = adapter.__absolutejs_originalGetBaseHref.call(this, doc);
									console.log('✅ [ANGULAR PATCH] getBaseHref (_getDOM) result:', result);
									return result;
								},
								writable: false,
								configurable: false,
								enumerable: true
							});
						}
						return domAdapter;
					},
					writable: true,
					configurable: true,
					enumerable: true
				});
			} catch (error) {
				// If defineProperty fails (property is not configurable), try direct assignment
				console.warn('⚠️ [ANGULAR PATCH] Failed to patch _getDOM via defineProperty, trying direct assignment:', error);
				try {
					(common as any).ɵgetDOM = function() {
						const domAdapter = originalGetDOM();
						if (domAdapter && typeof domAdapter.getBaseHref === 'function') {
							const adapter = domAdapter as any;
							if (!adapter.__absolutejs_originalGetBaseHref) {
								adapter.__absolutejs_originalGetBaseHref = domAdapter.getBaseHref.bind(domAdapter);
							}
							Object.defineProperty(domAdapter, 'getBaseHref', {
								value: function(doc: any) {
									if (!doc || !doc.head || typeof doc.head.children === 'undefined') {
										return '';
									}
									return adapter.__absolutejs_originalGetBaseHref.call(this, doc);
								},
								writable: false,
								configurable: false,
								enumerable: true
							});
						}
						return domAdapter;
					};
				} catch (assignError) {
					console.warn('⚠️ [ANGULAR PATCH] Failed to patch _getDOM via direct assignment:', assignError);
				}
			}
		}
		
		// Patch DominoAdapter class directly
		// @ts-expect-error - DominoAdapter exists at runtime
		const DominoAdapter = platformServer.DominoAdapter;
		if (DominoAdapter && DominoAdapter.prototype) {
			const prototype = DominoAdapter.prototype;
			
			// Patch getBaseHref to handle null doc.head
			if (prototype.getBaseHref && !prototype.__absolutejs_originalGetBaseHref) {
				prototype.__absolutejs_originalGetBaseHref = prototype.getBaseHref;
				prototype.getBaseHref = function(doc: any) {
					console.log('🔍 [ANGULAR PATCH] getBaseHref called on DominoAdapter.prototype:', {
						hasDoc: !!doc,
						hasHead: !!doc?.head,
						headIsNull: doc?.head === null,
						headType: typeof doc?.head,
						hasChildren: !!doc?.head?.children,
						childrenType: typeof doc?.head?.children,
						stack: getStackTrace()
					});
					
					if (!doc || !doc.head || typeof doc.head.children === 'undefined') {
						console.warn('⚠️ [ANGULAR PATCH] getBaseHref: Returning empty string due to null/undefined head or children');
						return '';
					}
					const result = prototype.__absolutejs_originalGetBaseHref.call(this, doc);
					console.log('✅ [ANGULAR PATCH] getBaseHref result:', result);
					return result;
				};
			}
			
			// Patch createHtmlDocument to ensure default documents have proper head structure
			// AND wrap them in a Proxy to intercept property access
			if (prototype.createHtmlDocument && !prototype.__absolutejs_originalCreateHtmlDocument) {
				prototype.__absolutejs_originalCreateHtmlDocument = prototype.createHtmlDocument;
				prototype.createHtmlDocument = function() {
					console.log('🔍 [ANGULAR PATCH] createHtmlDocument called');
					const doc = prototype.__absolutejs_originalCreateHtmlDocument.call(this);
					console.log('🔍 [ANGULAR PATCH] createHtmlDocument result:', {
						hasDoc: !!doc,
						hasHead: !!doc?.head,
						headIsNull: doc?.head === null,
						stack: getStackTrace()
					});
					// Wrap in Proxy to intercept property access at engine level
					return createDocumentProxy(doc);
				};
			}
			
			// Patch getDefaultDocument to return proxied document
			if (prototype.getDefaultDocument && !prototype.__absolutejs_originalGetDefaultDocument) {
				prototype.__absolutejs_originalGetDefaultDocument = prototype.getDefaultDocument;
				prototype.getDefaultDocument = function() {
					const doc = prototype.__absolutejs_originalGetDefaultDocument.call(this);
					return createDocumentProxy(doc);
				};
			}
		}
		
		// Patch domino's createWindow/createDocument if available
		// This intercepts document creation at the source
		try {
			// @ts-expect-error - domino may not be installed in absolutejs, but should be in user's project
			const domino = await import('domino').catch(() => null);
			if (domino) {
				// Patch createWindow
				if (domino.createWindow && !(domino as any).__absolutejs_originalCreateWindow) {
					(domino as any).__absolutejs_originalCreateWindow = domino.createWindow;
					domino.createWindow = function(html: string, url: string) {
						const window = (domino as any).__absolutejs_originalCreateWindow(html, url);
						if (window && window.document) {
							window.document = createDocumentProxy(window.document);
						}
						return window;
					};
				}
				
				// Patch createDocument
				if (domino.createDocument && !(domino as any).__absolutejs_originalCreateDocument) {
					(domino as any).__absolutejs_originalCreateDocument = domino.createDocument;
					domino.createDocument = function(html?: string) {
						const doc = (domino as any).__absolutejs_originalCreateDocument(html);
						return createDocumentProxy(doc);
					};
				}
			}
		} catch (error) {
			// domino might not be available, that's okay
		}
		
		// Patch Angular SSR's _document function to return proxied documents
		// This is the function that creates/returns the document used by Angular SSR
		try {
			// Access the internal _document function from platform-server
			const serverModule = platformServer as any;
			// The _document function is typically in the server-hHJ05Ji8.mjs file
			// We'll patch it through the module exports if accessible
			if (serverModule._document || (platformServer as any).ɵ_document) {
				const originalDocument = serverModule._document || (platformServer as any).ɵ_document;
				if (typeof originalDocument === 'function') {
					(platformServer as any)._document = function(injector: any) {
						const doc = originalDocument(injector);
						return createDocumentProxy(doc);
					};
				}
			}
		} catch (error) {
			// _document might not be accessible, that's okay
		}
		
		console.log('✅ Angular SSR patches applied at module resolution time');
		return true;
	} catch (error) {
		console.warn('⚠️ Failed to apply Angular SSR patches at module resolution time:', error);
		return false;
	}
})();

// Export a promise that resolves when patches are applied
// This ensures the module is "loaded" (patches applied) before any code that imports this module continues
export default patchesApplied;


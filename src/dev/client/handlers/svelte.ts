/* Svelte HMR update handler */

import { applyPageNonce } from '../cspNonce';
import { SVELTE_CSS_LOAD_TIMEOUT_MS } from '../constants';
import {
	saveDOMState,
	restoreDOMState,
	saveScrollState,
	restoreScrollState
} from '../domState';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';
import { sendAbsoluteHmrTiming } from '../hmrTiming';
import { swapCSSStylesheet } from '../cssUtils';

type SvelteHmrWindow = Window & {
	__SVELTE_HMR_ACCEPT__?: Record<string, (mod: unknown) => void>;
};

const collectCssRules = (sheet: CSSStyleSheet) => {
	let rules = '';
	for (let idx = 0; idx < sheet.cssRules.length; idx++) {
		const rule = sheet.cssRules[idx];
		if (!rule) continue;
		rules += `${rule.cssText}\n`;
	}

	return rules;
};

const preserveLinkAsInlineStyle = (link: HTMLLinkElement) => {
	try {
		const { sheet } = link;
		if (!sheet || sheet.cssRules.length === 0) {
			return null;
		}

		const style = applyPageNonce(document.createElement('style'));
		style.dataset.hmrPreserved = 'true';
		style.textContent = collectCssRules(sheet);
		document.head.appendChild(style);

		return style;
	} catch {
		/* Cross-origin sheets (e.g. Google Fonts) — clone as fallback */
		const clone = document.createElement('link');
		clone.rel = link.rel;
		clone.href = link.href;
		clone.dataset.hmrPreserved = 'true';
		document.head.appendChild(clone);

		return null;
	}
};

const preserveAllStylesheets = () => {
	const preservedStyles: HTMLStyleElement[] = [];
	document
		.querySelectorAll<HTMLLinkElement>('head link[rel="stylesheet"]')
		.forEach((link) => {
			const style = preserveLinkAsInlineStyle(link);
			if (style) {
				preservedStyles.push(style);
			}
		});

	/* Also preserve Svelte injected <style> tags (css: 'injected' mode) */
	document
		.querySelectorAll<HTMLStyleElement>(
			'head style:not([data-hmr-preserved])'
		)
		.forEach((style) => {
			const clone = applyPageNonce(document.createElement('style'));
			clone.dataset.hmrPreserved = 'true';
			clone.textContent = style.textContent;
			document.head.appendChild(clone);
		});

	return preservedStyles;
};

const buildLinkLoadPromise = (link: HTMLLinkElement) => {
	if (link.sheet && link.sheet.cssRules.length > 0) {
		return null;
	}

	const { promise, resolve } = Promise.withResolvers<void>();
	link.onload = () => {
		resolve();
	};
	link.onerror = () => {
		resolve();
	};
	setTimeout(resolve, SVELTE_CSS_LOAD_TIMEOUT_MS);

	return promise;
};

const cleanupAfterImport = (
	domState: ReturnType<typeof saveDOMState>,
	scrollState: ReturnType<typeof saveScrollState>
) => {
	document
		.querySelectorAll('[data-hmr-preserved="true"]')
		.forEach((element) => {
			element.remove();
		});
	restoreDOMState(document.body, domState);
	restoreScrollState(scrollState);
};

const waitForStylesAndCleanup = (
	domState: ReturnType<typeof saveDOMState>,
	scrollState: ReturnType<typeof saveScrollState>
) => {
	const newLinks = document.querySelectorAll<HTMLLinkElement>(
		'head link[rel="stylesheet"]:not([data-hmr-preserved])'
	);
	const loadPromises: Promise<void>[] = [];
	newLinks.forEach((link) => {
		const promise = buildLinkLoadPromise(link);
		if (promise) {
			loadPromises.push(promise);
		}
	});

	const cleanup = () => {
		cleanupAfterImport(domState, scrollState);
	};

	if (loadPromises.length > 0) {
		void Promise.all(loadPromises).then(cleanup);
	} else {
		cleanup();
	}
};

export const handleSvelteUpdate = (message: {
	data: {
		cssBaseName?: string;
		cssUrl?: string;
		html?: string;
		manifest?: Record<string, string>;
		pageModuleUrl?: string;
		serverDuration?: number;
		sourceFile?: string;
		updateType?: string;
	};
	timestamp?: number;
}) => {
	const svelteFrameworkCheck = detectCurrentFramework();
	if (svelteFrameworkCheck !== 'svelte') return;

	/* CSS-only update: hot-swap stylesheet, no remount needed */
	if (message.data.updateType === 'css-only' && message.data.cssUrl) {
		const clientStart = performance.now();
		const cssBaseName = message.data.cssBaseName || '';
		void swapCSSStylesheet(
			message.data.cssUrl,
			(href) => href.includes(cssBaseName) || href.includes('svelte')
		).then((applied) => {
			sendAbsoluteHmrTiming({
				clientStart,
				kind: 'css',
				outcome: applied ? 'applied' : 'failed',
				serverMs: message.data.serverDuration,
				updateId: message.timestamp
			});
		});

		return;
	}

	/* Component update. Svelte's own HMR keeps state: `$.hmr` swaps only the
	 * edited component, so every other component's `$state` survives. The
	 * edited component restarts from its real props, as in any Svelte HMR
	 * setup; nothing here reads state back out of the DOM. */

	/* Save DOM state and scroll position */
	const domState = saveDOMState(document.body);
	const scrollState = saveScrollState();

	/* CSS pre-update: swap stylesheet BEFORE importing to prevent FOUC */
	if (message.data.cssUrl) {
		const cssBaseName = message.data.cssBaseName || '';
		void swapCSSStylesheet(
			message.data.cssUrl,
			(href) => href.includes(cssBaseName) || href.includes('svelte')
		);
	}

	// O(1) Svelte 5 HMR: import the changed module, then call its
	// accept callback. Svelte's $.hmr() reactive wrapper swaps the
	// component in place — parent state and DOM survive untouched.
	const { pageModuleUrl } = message.data;
	if (pageModuleUrl) {
		const clientStart = performance.now();
		const modulePath = `${pageModuleUrl}?t=${Date.now()}`;

		const svelteWindow: SvelteHmrWindow = window;
		const acceptRegistry = svelteWindow.__SVELTE_HMR_ACCEPT__;

		// Save the OLD module's accept callback BEFORE importing. The exact
		// key is the broadcast `pageModuleUrl`; on the happy path it matches
		// the key the module server registered. If it doesn't (the registry
		// was repopulated under a slightly different URL key, or `bun --hot`
		// re-evaluated the module and reset `__SVELTE_HMR_ACCEPT__`), fall back
		// to a suffix/basename match so we still find the callback. Exact match
		// always wins, so the happy path is unchanged.
		let acceptFn = acceptRegistry?.[pageModuleUrl];
		if (!acceptFn && acceptRegistry) {
			const wantBase = pageModuleUrl.split('?')[0] ?? pageModuleUrl;
			const hit = Object.keys(acceptRegistry).find(
				(key) =>
					key === wantBase ||
					key.endsWith(wantBase) ||
					wantBase.endsWith(key)
			);
			if (hit) acceptFn = acceptRegistry[hit];
		}

		import(modulePath)
			.then((newModule) => {
				if (acceptFn) {
					acceptFn(newModule);
				} else if (typeof window.__SVELTE_REMOUNT__ === 'function') {
					/* No accept callback was registered for this module, so
					 * `$.hmr` can't wire the new code in. The import warmed the
					 * module cache; remount the page with its own props so the
					 * update still lands. */
					window.__SVELTE_REMOUNT__({
						...(window.__INITIAL_PROPS__ ?? {})
					});
				} else {
					/* Last resort: nothing can apply the update in place. */
					console.warn(
						'[HMR] Svelte accept callback missing and no remount available; reloading'
					);
					window.location.reload();

					return undefined;
				}

				if (message.data.serverDuration !== undefined) {
					sendAbsoluteHmrTiming({
						clientStart,
						kind: 'component',
						serverMs: message.data.serverDuration,
						updateId: message.timestamp
					});
				}

				return undefined;
			})
			.catch((err: unknown) => {
				console.warn('[HMR] Svelte HMR failed, reloading:', err);
				sendAbsoluteHmrTiming({
					clientStart,
					kind: 'component',
					outcome: 'reloaded',
					serverMs: message.data.serverDuration,
					updateId: message.timestamp
				});
				window.location.reload();
			});

		return;
	}

	// Bundled fallback: re-import the index file
	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'svelte'
	);
	if (!indexPath) {
		console.warn('[HMR] Svelte index path not found, reloading');
		window.location.reload();

		return;
	}

	preserveAllStylesheets();

	const modulePath = `${indexPath}?t=${Date.now()}`;
	import(modulePath)
		.then(() => {
			waitForStylesAndCleanup(domState, scrollState);

			return undefined;
		})
		.catch((err: unknown) => {
			console.warn('[HMR] Svelte import failed, reloading:', err);
			window.location.reload();
		});
};

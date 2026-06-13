/* Svelte HMR update handler */

import { SVELTE_CSS_LOAD_TIMEOUT_MS } from '../constants';
import {
	saveDOMState,
	restoreDOMState,
	saveScrollState,
	restoreScrollState
} from '../domState';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';

type SvelteHmrWindow = Window & {
	__SVELTE_HMR_ACCEPT__?: Record<string, (mod: unknown) => void>;
};

/* Swap a stylesheet link by matching cssBaseName or framework name */
const swapStylesheet = (
	cssUrl: string,
	cssBaseName: string,
	framework: string
) => {
	let existingLink: HTMLLinkElement | null = null;
	document
		.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
		.forEach((link) => {
			const href = link.getAttribute('href') ?? '';
			if (href.includes(cssBaseName) || href.includes(framework)) {
				existingLink = link;
			}
		});

	if (!existingLink) {
		return;
	}

	const capturedExisting: HTMLLinkElement = existingLink;
	const newLink = document.createElement('link');
	newLink.rel = 'stylesheet';
	newLink.href = `${cssUrl}?t=${Date.now()}`;
	newLink.onload = () => {
		if (capturedExisting && capturedExisting.parentNode) {
			capturedExisting.remove();
		}
	};
	document.head.appendChild(newLink);
};

const extractCountFromDOM = () => {
	const countButton = document.querySelector('button');
	if (!countButton || !countButton.textContent) {
		return {};
	}

	const countMatch = countButton.textContent.match(/(\d+)/);
	if (!countMatch) {
		return {};
	}

	return { initialCount: parseInt(countMatch[1] ?? '0', 10) };
};

const loadStateFromSession = () => {
	try {
		const stored = sessionStorage.getItem('__SVELTE_HMR_STATE__');
		if (!stored) {
			return {};
		}

		const parsed: Record<string, unknown> = JSON.parse(stored);
		if (parsed && Object.keys(parsed).length > 0) {
			return parsed;
		}

		return {};
	} catch {
		return {};
	}
};

const saveStateToSession = (preservedState: Record<string, unknown>) => {
	if (Object.keys(preservedState).length === 0) {
		return;
	}

	try {
		sessionStorage.setItem(
			'__SVELTE_HMR_STATE__',
			JSON.stringify(preservedState)
		);
	} catch {
		/* ignore */
	}
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

		const style = document.createElement('style');
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
			const clone = document.createElement('style');
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
}) => {
	const svelteFrameworkCheck = detectCurrentFramework();
	if (svelteFrameworkCheck !== 'svelte') return;

	/* CSS-only update: hot-swap stylesheet, no remount needed */
	if (message.data.updateType === 'css-only' && message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'svelte'
		);

		return;
	}

	/* Component update: preserve state, re-import (bootstrap handles unmount + mount) */

	/* Save DOM state and scroll position */
	const domState = saveDOMState(document.body);
	const scrollState = saveScrollState();

	let preservedState: Record<string, unknown> = extractCountFromDOM();

	if (Object.keys(preservedState).length === 0) {
		preservedState = loadStateFromSession();
	}

	/* Set preserved state on window + backup to sessionStorage */
	window.__HMR_PRESERVED_STATE__ = preservedState;
	saveStateToSession(preservedState);

	/* CSS pre-update: swap stylesheet BEFORE importing to prevent FOUC */
	if (message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'svelte'
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
				let applied = false;
				if (acceptFn) {
					acceptFn(newModule);
					applied = true;
				}

				/* $.hmr_accept swaps component code in place but re-runs
				 * the <script> body with the original mount props, so any
				 * state seeded from a prop (e.g. a composable doing
				 * $state(initialCount)) resets. Remount with the preserved
				 * state merged into props — mirroring the bundled-fallback
				 * bootstrap — so that state carries across (issue #41). */
				const preserved = window.__HMR_PRESERVED_STATE__;
				const remount = window.__SVELTE_REMOUNT__;
				const hasPreserved =
					preserved && Object.keys(preserved).length > 0;

				if (applied) {
					if (typeof remount === 'function' && hasPreserved) {
						remount({
							...(window.__INITIAL_PROPS__ ?? {}),
							...preserved
						});
					}
				} else if (typeof remount === 'function') {
					/* Resilience fallback: no accept callback was found, so
					 * `$.hmr` never wired the freshly imported module in. The
					 * import warmed the module cache; remount the page with
					 * merged props to actually apply the new code instead of
					 * silently doing nothing. */
					remount({
						...(window.__INITIAL_PROPS__ ?? {}),
						...(preserved ?? {})
					});
				} else {
					/* Last resort: nothing can apply the update in place. */
					console.warn(
						'[HMR] Svelte accept callback missing and no remount available; reloading'
					);
					window.__HMR_PRESERVED_STATE__ = undefined;
					window.location.reload();

					return undefined;
				}
				window.__HMR_PRESERVED_STATE__ = undefined;

				if (
					window.__HMR_WS__ &&
					message.data.serverDuration !== undefined
				) {
					const clientMs = Math.round(
						performance.now() - clientStart
					);
					const total = (message.data.serverDuration ?? 0) + clientMs;
					window.__HMR_WS__.send(
						JSON.stringify({ duration: total, type: 'hmr-timing' })
					);
				}

				return undefined;
			})
			.catch((err: unknown) => {
				console.warn('[HMR] Svelte HMR failed, reloading:', err);
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

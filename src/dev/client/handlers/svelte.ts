/* Svelte HMR update handler */

import {
	saveDOMState,
	restoreDOMState,
	saveScrollState,
	restoreScrollState
} from '../domState';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';

/* Swap a stylesheet link by matching cssBaseName or framework name */
const swapStylesheet = (
	cssUrl: string,
	cssBaseName: string,
	framework: string
): void => {
	let existingLink: HTMLLinkElement | null = null;
	document
		.querySelectorAll('link[rel="stylesheet"]')
		.forEach(function (link) {
			const href = (link as HTMLLinkElement).getAttribute('href') || '';
			if (href.includes(cssBaseName) || href.includes(framework)) {
				existingLink = link as HTMLLinkElement;
			}
		});

	if (existingLink) {
		const capturedExisting = existingLink as HTMLLinkElement;
		const newLink = document.createElement('link');
		newLink.rel = 'stylesheet';
		newLink.href = cssUrl + '?t=' + Date.now();
		newLink.onload = function () {
			if (capturedExisting && capturedExisting.parentNode) {
				capturedExisting.remove();
			}
		};
		document.head.appendChild(newLink);
	}
};

export const handleSvelteUpdate = (message: {
	data: {
		cssBaseName?: string;
		cssUrl?: string;
		html?: string;
		manifest?: Record<string, string>;
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

	/* Extract state from DOM (Svelte 5 $state is not externally accessible).
	   Use a flexible regex — the template text around the number may change
	   between HMR cycles (e.g. user adds/removes text near {getCount()}). */
	let preservedState: Record<string, unknown> = {};
	const countButton = document.querySelector('button');
	if (countButton && countButton.textContent) {
		const countMatch = countButton.textContent.match(/(\d+)/);
		if (countMatch) {
			preservedState.initialCount = parseInt(countMatch[1]!, 10);
		}
	}

	/* If DOM extraction failed, fall back to sessionStorage instead of
	   overwriting a good previous value with empty state. */
	if (Object.keys(preservedState).length === 0) {
		try {
			const stored = sessionStorage.getItem('__SVELTE_HMR_STATE__');
			if (stored) {
				const parsed = JSON.parse(stored) as Record<string, unknown>;
				if (parsed && Object.keys(parsed).length > 0) {
					preservedState = parsed;
				}
			}
		} catch (_err) {
			/* ignore */
		}
	}

	/* Set preserved state on window + backup to sessionStorage */
	window.__HMR_PRESERVED_STATE__ = preservedState;
	if (Object.keys(preservedState).length > 0) {
		try {
			sessionStorage.setItem(
				'__SVELTE_HMR_STATE__',
				JSON.stringify(preservedState)
			);
		} catch (_err) {
			/* ignore */
		}
	}
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

	/* CSS pre-update: swap stylesheet BEFORE importing to prevent FOUC */
	if (message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'svelte'
		);
	}

	/* Preserve styles as inline <style> elements so they survive the
	   unmount/mount cycle. Svelte removes <svelte:head> content (including
	   <link> tags) on unmount. Inline styles apply synchronously — unlike
	   cloned <link> tags which need to re-fetch even from cache. */
	const preservedStyles: HTMLStyleElement[] = [];
	document
		.querySelectorAll<HTMLLinkElement>('head link[rel="stylesheet"]')
		.forEach(function (link) {
			try {
				const sheet = link.sheet;
				if (sheet && sheet.cssRules.length > 0) {
					const style = document.createElement('style');
					style.dataset.hmrPreserved = 'true';
					let rules = '';
					for (let idx = 0; idx < sheet.cssRules.length; idx++) {
						rules += sheet.cssRules[idx]!.cssText + '\n';
					}
					style.textContent = rules;
					document.head.appendChild(style);
					preservedStyles.push(style);
				}
			} catch (_err) {
				/* Cross-origin sheets (e.g. Google Fonts) — clone as fallback */
				const clone = link.cloneNode(true) as HTMLLinkElement;
				clone.dataset.hmrPreserved = 'true';
				document.head.appendChild(clone);
			}
		});

	/* Also preserve Svelte injected <style> tags (css: 'injected' mode) */
	document
		.querySelectorAll<HTMLStyleElement>(
			'head style:not([data-hmr-preserved])'
		)
		.forEach(function (style) {
			const clone = document.createElement('style');
			clone.dataset.hmrPreserved = 'true';
			clone.textContent = style.textContent;
			document.head.appendChild(clone);
		});

	const modulePath = indexPath + '?t=' + Date.now();
	import(/* @vite-ignore */ modulePath)
		.then(function () {
			/* Wait for new <link> stylesheets (re-added by svelte:head in mount)
			   to fully load before removing preserved styles. Without this,
			   removing inline preserved styles leaves a gap until <link> loads. */
			const newLinks = document.querySelectorAll<HTMLLinkElement>(
				'head link[rel="stylesheet"]:not([data-hmr-preserved])'
			);
			const loadPromises: Promise<void>[] = [];
			newLinks.forEach(function (link) {
				if (!link.sheet || link.sheet.cssRules.length === 0) {
					loadPromises.push(
						new Promise<void>(function (resolve) {
							link.onload = function () {
								resolve();
							};
							link.onerror = function () {
								resolve();
							};
							setTimeout(resolve, 500);
						})
					);
				}
			});

			const cleanup = function () {
				document
					.querySelectorAll('[data-hmr-preserved="true"]')
					.forEach(function (element) {
						element.remove();
					});
				restoreDOMState(document.body, domState);
				restoreScrollState(scrollState);
			};

			if (loadPromises.length > 0) {
				Promise.all(loadPromises).then(cleanup);
			} else {
				cleanup();
			}
		})
		.catch(function (err: unknown) {
			console.warn('[HMR] Svelte import failed, reloading:', err);
			window.location.reload();
		});
};

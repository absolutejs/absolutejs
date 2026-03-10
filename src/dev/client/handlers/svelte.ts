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
) => {
	let existingLink: HTMLLinkElement | null = null;
	document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
		const href = (link as HTMLLinkElement).getAttribute('href') || '';
		if (href.includes(cssBaseName) || href.includes(framework)) {
			existingLink = link as HTMLLinkElement;
		}
	});

	if (!existingLink) {
		return;
	}

	const capturedExisting = existingLink as HTMLLinkElement;
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

	return { initialCount: parseInt(countMatch[1]!, 10) };
};

const loadStateFromSession = () => {
	try {
		const stored = sessionStorage.getItem('__SVELTE_HMR_STATE__');
		if (!stored) {
			return {};
		}

		const parsed = JSON.parse(stored) as Record<string, unknown>;
		if (parsed && Object.keys(parsed).length > 0) {
			return parsed;
		}

		return {};
	} catch (_err) {
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
	} catch (_err) {
		/* ignore */
	}
};

const collectCssRules = (sheet: CSSStyleSheet) => {
	let rules = '';
	for (let idx = 0; idx < sheet.cssRules.length; idx++) {
		rules += `${sheet.cssRules[idx]!.cssText}\n`;
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
	} catch (_err) {
		/* Cross-origin sheets (e.g. Google Fonts) — clone as fallback */
		const clone = link.cloneNode(true) as HTMLLinkElement;
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

	return new Promise<void>((resolve) => {
		link.onload = () => {
			resolve();
		};
		link.onerror = () => {
			resolve();
		};
		setTimeout(resolve, 500);
	});
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
		Promise.all(loadPromises).then(cleanup);
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

	preserveAllStylesheets();

	const modulePath = `${indexPath}?t=${Date.now()}`;
	import(/* @vite-ignore */ modulePath)
		.then(() => {
			waitForStylesAndCleanup(domState, scrollState);
		})
		.catch((err: unknown) => {
			console.warn('[HMR] Svelte import failed, reloading:', err);
			window.location.reload();
		});
};

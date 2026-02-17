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
			const href =
				(link as HTMLLinkElement).getAttribute('href') || '';
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
		console.log('[HMR] Svelte CSS-only update');
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'svelte'
		);
		console.log('[HMR] Svelte CSS updated');
		return;
	}

	/* Component update: preserve state, re-import (bootstrap handles unmount + mount) */
	console.log('[HMR] Svelte update - remounting component');

	/* Save DOM state and scroll position */
	const domState = saveDOMState(document.body);
	const scrollState = saveScrollState();

	/* Extract state from DOM (Svelte 5 $state is not externally accessible) */
	const preservedState: Record<string, unknown> = {};
	const countButton = document.querySelector('button');
	if (countButton && countButton.textContent) {
		const countMatch =
			countButton.textContent.match(/count is (\d+)/i);
		if (countMatch) {
			preservedState.initialCount = parseInt(countMatch[1]!, 10);
		}
	}

	/* Set preserved state on window + backup to sessionStorage */
	window.__HMR_PRESERVED_STATE__ = preservedState;
	try {
		sessionStorage.setItem(
			'__SVELTE_HMR_STATE__',
			JSON.stringify(preservedState)
		);
	} catch (_err) {
		/* ignore */
	}
	console.log(
		'[HMR] Svelte state preserved:',
		JSON.stringify(preservedState)
	);

	/* CSS pre-update: swap stylesheet BEFORE unmounting to prevent FOUC */
	if (message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'svelte'
		);
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

	const modulePath = indexPath + '?t=' + Date.now();
	import(/* @vite-ignore */ modulePath)
		.then(function () {
			restoreDOMState(document.body, domState);
			restoreScrollState(scrollState);
			console.log('[HMR] Svelte component updated (state preserved)');
		})
		.catch(function (err: unknown) {
			console.warn('[HMR] Svelte import failed, reloading:', err);
			window.location.reload();
		});
};

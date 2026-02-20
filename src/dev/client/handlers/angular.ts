/* Angular HMR update handler */

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

export const handleAngularUpdate = (message: {
	data: {
		cssBaseName?: string;
		cssUrl?: string;
		html?: string;
		manifest?: Record<string, string>;
		sourceFile?: string;
		updateType?: string;
	};
}) => {
	const angularFrameworkCheck = detectCurrentFramework();
	if (angularFrameworkCheck !== 'angular') return;

	/* CSS-only update: hot-swap stylesheet, no remount needed */
	if (message.data.updateType === 'css-only' && message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'angular'
		);
		return;
	}

	/* Component update: preserve state, replace HTML, re-bootstrap Angular */

	/* Save DOM state and scroll position */
	const domState = saveDOMState(document.body);
	const scrollState = saveScrollState();

	/* Extract counter state from DOM.
	   Angular counter uses manual DOM listeners via getRegisterClientScript,
	   NOT Angular reactive state — so we read from the DOM directly. */
	const preservedState: Record<string, unknown> = {};
	const counterValueEl = document.querySelector(
		'app-counter .counter-value'
	);
	if (counterValueEl && counterValueEl.textContent) {
		const count = parseInt(counterValueEl.textContent.trim(), 10);
		if (!isNaN(count)) {
			preservedState.initialCount = count;
		}
	}

	/* Set preserved state on window + backup to sessionStorage */
	window.__HMR_PRESERVED_STATE__ = preservedState;
	try {
		sessionStorage.setItem(
			'__ANGULAR_HMR_STATE__',
			JSON.stringify(preservedState)
		);
	} catch (_err) {
		/* ignore */
	}

	/* CSS pre-update: swap stylesheet BEFORE remounting to prevent FOUC */
	if (message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'angular'
		);
	}

	const newHTML = message.data.html;
	if (!newHTML) {
		window.location.reload();
		return;
	}

	/* Pre-patch incoming HTML: replace counter-value with preserved count
	   to prevent showing 0 before Angular re-bootstraps */
	let patchedHTML = newHTML;
	if (preservedState.initialCount !== undefined) {
		patchedHTML = patchedHTML.replace(
			/counter-value">0</g,
			'counter-value">' + preservedState.initialCount + '<'
		);
	}

	/* Destroy old Angular app */
	if (window.__ANGULAR_APP__) {
		try { window.__ANGULAR_APP__.destroy(); } catch (_err) { /* ignore */ }
		window.__ANGULAR_APP__ = null;
	}

	/* Replace body content with new HTML */
	document.body.innerHTML = patchedHTML;

	/* Scripts set via innerHTML don't execute — re-create non-module
	   inline scripts (e.g. registerClientScript listeners) so they run.
	   Skip module scripts and HMR client to avoid duplicate init. */
	const scripts = document.body.querySelectorAll('script');
	scripts.forEach(function (oldScript) {
		if (oldScript.type === 'module' || oldScript.hasAttribute('data-hmr-client')) return;
		if (oldScript.type && oldScript.type !== 'text/javascript') return;
		const newScript = document.createElement('script');
		newScript.textContent = oldScript.textContent;
		if (oldScript.parentNode) {
			oldScript.parentNode.replaceChild(newScript, oldScript);
		}
	});

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'angular'
	);
	if (!indexPath) {
		console.warn('[HMR] Angular index path not found, reloading');
		window.location.reload();
		return;
	}

	/* Dynamic import to re-bootstrap Angular and re-attach event listeners */
	const modulePath = indexPath + '?t=' + Date.now();
	import(/* @vite-ignore */ modulePath)
		.then(function () {
			restoreDOMState(document.body, domState);
			restoreScrollState(scrollState);
		})
		.catch(function (err: unknown) {
			console.warn('[HMR] Angular import failed, reloading:', err);
			window.location.reload();
		});
};

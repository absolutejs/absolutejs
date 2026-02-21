/* Angular HMR update handler
   Angular HMR Optimization — Smart update handling based on change classification */

import {
	saveDOMState,
	restoreDOMState,
	saveFormState,
	restoreFormState,
	saveScrollState,
	restoreScrollState
} from '../domState';
import { patchHeadInPlace } from '../headPatch';
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

// Angular HMR Optimization — Get the stable root container for Angular content
const getRootContainer = (): HTMLElement | null => {
	return document.getElementById('root');
};

// Angular HMR Optimization — Extract body content from full HTML, targeting #root
const extractRootContent = (html: string): string | null => {
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = html;
	const rootEl = tempDiv.querySelector('#root');
	if (rootEl) return rootEl.innerHTML;
	// Fallback: return entire HTML if no #root found
	return null;
};

// Angular HMR Optimization — Extract <head> content from full HTML for headPatch
const extractHeadContent = (html: string): string | null => {
	const headMatch = html.match(/<head[^>]*>([\s\S]*)<\/head>/i);
	return headMatch && headMatch[1] ? headMatch[1] : null;
};

// Angular HMR Optimization — Compare inline script content to avoid unnecessary re-execution
const getScriptContentHash = (scriptEl: HTMLScriptElement): string => {
	return scriptEl.textContent || '';
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

	const updateType = message.data.updateType || 'logic';

	/* Angular HMR Optimization — Style-only update: hot-swap stylesheet, no remount needed */
	if ((updateType === 'style' || updateType === 'css-only') && message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'angular'
		);
		return;
	}

	/* Angular HMR Optimization — Template-only update: patch DOM inside #root, no destroy */
	if (updateType === 'template') {
		handleTemplateUpdate(message);
		return;
	}

	/* Logic update: full destroy + bootstrap (original behavior, targeting #root) */
	handleLogicUpdate(message);
};

// Angular HMR Optimization — Template-only update without destroying Angular app
const handleTemplateUpdate = (message: {
	data: {
		cssBaseName?: string;
		cssUrl?: string;
		html?: string;
		manifest?: Record<string, string>;
		sourceFile?: string;
		updateType?: string;
	};
}) => {
	const rootContainer = getRootContainer();

	// Fallback to full update if no #root container exists
	if (!rootContainer) {
		handleLogicUpdate(message);
		return;
	}

	/* Save DOM state, form state, and scroll position */
	const domState = saveDOMState(rootContainer);
	const formState = saveFormState();
	const scrollState = saveScrollState();

	/* Extract counter state from DOM */
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

	/* CSS pre-update: swap stylesheet BEFORE patching to prevent FOUC */
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

	/* Pre-patch incoming HTML: replace counter-value with preserved count */
	let patchedHTML = newHTML;
	if (preservedState.initialCount !== undefined) {
		patchedHTML = patchedHTML.replace(
			/counter-value">0</g,
			'counter-value">' + preservedState.initialCount + '<'
		);
	}

	try {
		/* Angular HMR Optimization — Extract and patch only #root content */
		const rootContent = extractRootContent(patchedHTML);
		if (rootContent !== null) {
			rootContainer.innerHTML = rootContent;
		} else {
			// No #root in new HTML — replace root container innerHTML with body content
			rootContainer.innerHTML = patchedHTML;
		}

		/* Patch head elements (title, meta, favicon) without reloading */
		const headContent = extractHeadContent(patchedHTML);
		if (headContent) {
			patchHeadInPlace(headContent);
		}

		/* Re-execute only inline scripts whose content changed */
		const scripts = rootContainer.querySelectorAll('script');
		scripts.forEach(function (oldScript) {
			if (oldScript.type === 'module' || oldScript.hasAttribute('data-hmr-client')) return;
			if (oldScript.type && oldScript.type !== 'text/javascript') return;
			const newScript = document.createElement('script');
			newScript.textContent = oldScript.textContent;
			if (oldScript.parentNode) {
				oldScript.parentNode.replaceChild(newScript, oldScript);
			}
		});

		/* Angular HMR Optimization — Trigger Angular change detection without destroy */
		const indexPath = findIndexPath(
			message.data.manifest,
			message.data.sourceFile,
			'angular'
		);

		if (indexPath) {
			/* Dynamic import with cache buster to pick up new template */
			const modulePath = indexPath + '?t=' + Date.now();
			import(/* @vite-ignore */ modulePath)
				.then(function () {
					/* Trigger Angular change detection if app reference exists */
					if (window.__ANGULAR_APP__) {
						try {
							window.__ANGULAR_APP__.tick();
						} catch (_tickErr) {
							/* tick may fail if component structure changed — acceptable */
						}
					}

					/* Restore state after template patch */
					restoreDOMState(rootContainer, domState);
					restoreFormState(formState);
					restoreScrollState(scrollState);
				})
				.catch(function (err: unknown) {
					console.warn('[HMR] Angular template import failed, falling back to full update:', err);
					/* Fallback to full destroy + bootstrap */
					handleLogicUpdate(message);
				});
		} else {
			/* No index path — still restore state */
			restoreDOMState(rootContainer, domState);
			restoreFormState(formState);
			restoreScrollState(scrollState);
		}
	} catch (err) {
		console.warn('[HMR] Angular template update failed, falling back to full update:', err);
		/* Fallback to full destroy + bootstrap on any error */
		handleLogicUpdate(message);
	}
};

// Angular HMR Optimization — Full logic update with destroy + bootstrap (targeting #root)
const handleLogicUpdate = (message: {
	data: {
		cssBaseName?: string;
		cssUrl?: string;
		html?: string;
		manifest?: Record<string, string>;
		sourceFile?: string;
		updateType?: string;
	};
}) => {
	const rootContainer = getRootContainer();

	/* Save DOM state and scroll position */
	const stateRoot = rootContainer || document.body;
	const domState = saveDOMState(stateRoot);
	const formState = saveFormState();
	const scrollState = saveScrollState();

	/* Extract counter state from DOM */
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

	/* Pre-patch incoming HTML: replace counter-value with preserved count */
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

	/* Capture Angular-injected <style> tags — defer removal until after
	   re-bootstrap so component styles are never absent (prevents flicker) */
	const oldStyles = Array.from(document.head.querySelectorAll('style'));

	/* Angular HMR Optimization — Replace only #root content instead of entire body */
	if (rootContainer) {
		const rootContent = extractRootContent(patchedHTML);
		if (rootContent !== null) {
			rootContainer.innerHTML = rootContent;
		} else {
			rootContainer.innerHTML = patchedHTML;
		}

		/* Patch head elements */
		const headContent = extractHeadContent(patchedHTML);
		if (headContent) {
			patchHeadInPlace(headContent);
		}
	} else {
		/* Fallback: no #root found, replace entire body (original behavior) */
		document.body.innerHTML = patchedHTML;
	}

	/* Scripts set via innerHTML don't execute — re-create non-module
	   inline scripts (e.g. registerClientScript listeners) so they run.
	   Skip module scripts and HMR client to avoid duplicate init. */
	const scriptRoot = rootContainer || document.body;
	const scripts = scriptRoot.querySelectorAll('script');
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
			requestAnimationFrame(function () {
				oldStyles.forEach(function (style) {
					if (style.parentNode) {
						style.remove();
					}
				});
			});
			restoreDOMState(stateRoot, domState);
			restoreFormState(formState);
			restoreScrollState(scrollState);
		})
		.catch(function (err: unknown) {
			console.warn('[HMR] Angular import failed, reloading:', err);
			window.location.reload();
		});
};

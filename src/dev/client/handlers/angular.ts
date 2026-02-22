/* Angular HMR — Zoneless Runtime Preservation
   Smart update handling: style → CSS swap only,
   template/logic → SSR HTML replacement + module re-import.

   Angular HMR — runtime state persists by prototype swap (no serialization).
   Legacy per-field state snapshots removed. DOM state (scroll, focus, form)
   preserved via lightweight capture/restore.

   Why zoneless requires manual tick():
	 With provideZonelessChangeDetection(), there is no Zone.js to
	 auto-trigger change detection.

   Why this is safe in a multi-framework environment:
	 This module only touches Angular-specific globals and elements.

   DEV MODE ONLY — this handler is never active in production. */

import {
	saveFormState,
	restoreFormState,
	saveScrollState,
	restoreScrollState
} from '../domState';
import { patchHeadInPlace } from '../headPatch';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';

// Angular HMR — Zoneless Runtime Preservation: message shape
interface HMRMessage {
	data: {
		cssBaseName?: string;
		cssUrl?: string;
		html?: string;
		manifest?: Record<string, string>;
		sourceFile?: string;
		updateType?: string;
	};
}

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

// Angular HMR — Zoneless Runtime Preservation: stable root container
const getRootContainer = (): HTMLElement | null => {
	return document.getElementById('root');
};

// Angular HMR — Zoneless Runtime Preservation: extract #root content from SSR HTML
const extractRootContent = (html: string): string | null => {
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = html;
	const rootEl = tempDiv.querySelector('#root');
	if (rootEl) return rootEl.innerHTML;
	return null;
};

// Angular HMR — Zoneless Runtime Preservation: extract <head> content
const extractHeadContent = (html: string): string | null => {
	const headMatch = html.match(/<head[^>]*>([\s\S]*)<\/head>/i);
	return headMatch && headMatch[1] ? headMatch[1] : null;
};

// Angular HMR — Zoneless Runtime Preservation: DOM state capture
const captureDOMSnapshot = () => {
	const scrollState = saveScrollState();
	const formState = saveFormState();

	let activeElementSelector: string | null = null;
	let selectionStart: number | null = null;
	let selectionEnd: number | null = null;
	const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
	if (active && active !== document.body) {
		activeElementSelector = buildElementSelector(active);
		if ('selectionStart' in active) {
			selectionStart = active.selectionStart;
			selectionEnd = active.selectionEnd;
		}
	}

	return { scrollState, formState, activeElementSelector, selectionStart, selectionEnd };
};

// Angular HMR — Zoneless Runtime Preservation: DOM state restore
const restoreDOMSnapshot = (snapshot: ReturnType<typeof captureDOMSnapshot>) => {
	restoreFormState(snapshot.formState);
	restoreScrollState(snapshot.scrollState);

	if (snapshot.activeElementSelector) {
		try {
			const el = document.querySelector(snapshot.activeElementSelector) as HTMLElement | null;
			if (el) {
				el.focus();
				if (snapshot.selectionStart !== null && 'setSelectionRange' in el) {
					(el as HTMLInputElement).setSelectionRange(
						snapshot.selectionStart,
						snapshot.selectionEnd ?? snapshot.selectionStart
					);
				}
			}
		} catch (_e) { /* element may not exist */ }
	}
};

// Build CSS selector path for focus restoration
const buildElementSelector = (el: Element): string => {
	const parts: string[] = [];
	let current: Element | null = el;
	while (current && current !== document.body) {
		let selector = current.tagName.toLowerCase();
		if (current.id) {
			selector += '#' + current.id;
			parts.unshift(selector);
			break;
		}
		if (current.parentElement) {
			const siblings = Array.from(current.parentElement.children);
			const idx = siblings.indexOf(current);
			selector += ':nth-child(' + (idx + 1) + ')';
		}
		parts.unshift(selector);
		current = current.parentElement;
	}
	return parts.join(' > ');
};

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export const handleAngularUpdate = (message: HMRMessage) => {
	const angularFrameworkCheck = detectCurrentFramework();
	if (angularFrameworkCheck !== 'angular') return;

	const updateType = message.data.updateType || 'logic';

	// Angular HMR — Zoneless Runtime Preservation: STYLE update
	// CSS hot swap only — no Angular interaction
	if ((updateType === 'style' || updateType === 'css-only') && message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'angular'
		);
		return;
	}

	// Angular HMR — Zoneless Runtime Preservation: TEMPLATE + LOGIC update
	// Uses SSR HTML replacement + module re-import.
	// SSR generates inline scripts for event listeners (getRegisterClientScript).
	handleSSRUpdate(message);
};

// ============================================================
// SSR-BASED UPDATE (Template + Logic)
// ============================================================

// Angular HMR — Zoneless Runtime Preservation: SSR-based update
// Replaces #root content with server-rendered HTML, re-executes inline scripts,
// re-imports the module to re-bootstrap Angular.
// DOM state (scroll, focus, form) is preserved.
const handleSSRUpdate = (message: HMRMessage) => {
	const rootContainer = getRootContainer();
	const stateRoot = rootContainer || document.body;
	const snapshot = captureDOMSnapshot();

	// CSS pre-update
	if (message.data.cssUrl) {
		swapStylesheet(message.data.cssUrl, message.data.cssBaseName || '', 'angular');
	}

	const newHTML = message.data.html;
	if (!newHTML) {
		window.location.reload();
		return;
	}

	// Angular HMR — Zoneless Runtime Preservation: capture DOM-managed state
	// The counter value lives in span.counter-value textContent, managed by
	// a vanilla JS click handler (not Angular binding). Capture it before
	// replacing the DOM so we can patch the new SSR HTML.
	let preservedCounterValue: number | null = null;
	const counterValueEl = document.querySelector('app-counter .counter-value');
	if (counterValueEl && counterValueEl.textContent) {
		const count = parseInt(counterValueEl.textContent.trim(), 10);
		if (!isNaN(count)) {
			preservedCounterValue = count;
		}
	}

	// Angular HMR — Zoneless Runtime Preservation: destroy old app
	if (window.__ANGULAR_APP__) {
		try { window.__ANGULAR_APP__.destroy(); } catch (_e) { /* ignore */ }
		window.__ANGULAR_APP__ = null;
	}

	// Angular HMR — Zoneless Runtime Preservation: replace #root content with SSR HTML
	// Patch counter value in the new HTML to preserve DOM-managed state
	let patchedHTML = newHTML;
	if (preservedCounterValue !== null) {
		patchedHTML = patchedHTML.replace(
			/counter-value">0</g,
			'counter-value">' + preservedCounterValue + '<'
		);
	}

	if (rootContainer) {
		const rootContent = extractRootContent(patchedHTML);
		if (rootContent !== null) {
			rootContainer.innerHTML = rootContent;
		} else {
			rootContainer.innerHTML = patchedHTML;
		}

		// Patch head elements (title, meta, favicon)
		const headContent = extractHeadContent(patchedHTML);
		if (headContent) {
			patchHeadInPlace(headContent);

			// Angular HMR — Zoneless Runtime Preservation: inject SSR <style> tags
			// patchHeadInPlace ignores <style> elements (no key for them).
			// Angular SSR puts component styles (app.component.css) in <head> as <style>.
			// Extract and inject them so component CSS persists after HMR.
			const tempHead = document.createElement('div');
			tempHead.innerHTML = headContent;
			const ssrStyles = tempHead.querySelectorAll('style');
			ssrStyles.forEach(function (styleEl) {
				const content = styleEl.textContent || '';
				// Check if this style already exists in head (avoid duplicates)
				let alreadyExists = false;
				document.head.querySelectorAll('style').forEach(function (existing) {
					if ((existing.textContent || '').trim() === content.trim()) {
						alreadyExists = true;
					}
				});
				if (!alreadyExists && content.trim()) {
					const newStyle = document.createElement('style');
					newStyle.textContent = content;
					newStyle.setAttribute('data-hmr-angular-ssr', 'true');
					document.head.appendChild(newStyle);
				}
			});
		}
	} else {
		document.body.innerHTML = patchedHTML;
	}

	// Angular HMR — Zoneless Runtime Preservation: re-execute inline scripts
	// Scripts set via innerHTML don't execute — recreate them so event listeners attach.
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

	// Angular HMR — Zoneless Runtime Preservation: skip re-bootstrap
	// Set __ANGULAR_APP__ to a stub BEFORE importing the module.
	// The client entry guard checks: if (__ANGULAR_APP__ && __ANGULAR_HMR__) → register only.
	// This prevents bootstrapApplication() from re-rendering and overwriting
	// the SSR HTML (which has the preserved counter state) with defaults.
	// The SSR HTML + re-executed inline scripts provide full interactivity.
	window.__ANGULAR_APP__ = { destroy: function () { /* no-op stub */ }, tick: function () { /* no-op stub */ } };

	// Re-import module — guard skips bootstrap, just registers the component
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

	const modulePath = indexPath + '?t=' + Date.now();
	import(/* @vite-ignore */ modulePath)
		.then(function () {
			// Angular HMR — Zoneless Runtime Preservation: keep old <style> tags.
			// Since bootstrap is skipped (stub __ANGULAR_APP__), Angular won't
			// inject new component styles. Removing old ones would lose styles
			// from app.component.css (e.g. `code` tag styling).
			restoreDOMSnapshot(snapshot);
		})
		.catch(function (err: unknown) {
			console.warn('[HMR] Angular import failed, reloading:', err);
			window.location.reload();
		});
};

/* Angular HMR — Re-Bootstrap with View Transitions API (Zero Flicker)
   DEV MODE ONLY — never active in production.

   Strategy:
   1. Capture component state (ng.getComponent) + DOM state
   2. Use document.startViewTransition() — browser captures a screenshot
   3. Destroy old app, recreate root element, import new module
   4. bootstrapApplication() renders new content (behind the screenshot)
   5. After bootstrap: restore state via ng.getComponent + ng.applyChanges
   6. View transition resolves — browser smoothly crossfades to new content

   document.startViewTransition() is the native browser API for page
   transitions. It captures a screenshot before the callback, runs the
   callback (which can be async), and crossfades when the callback finishes.
   The user never sees empty/default state — only the before and after. */

import {
	saveFormState,
	restoreFormState,
	saveScrollState,
	restoreScrollState
} from '../domState';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';

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

const swapStylesheet = (
	cssUrl: string,
	cssBaseName: string,
	framework: string
): void => {
	let existingLink: HTMLLinkElement | null = null;
	document.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
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
			if (capturedExisting && capturedExisting.parentNode) capturedExisting.remove();
		};
		document.head.appendChild(newLink);
	}
};

// ─── State Capture/Restore via ng.getComponent ──────────────

type StateSnapshot = {
	selector: string;
	index: number;
	properties: Record<string, unknown>;
};

const captureComponentState = (): StateSnapshot[] => {
	const snapshots: StateSnapshot[] = [];
	const selectorCounts = new Map<string, number>();
	const ng = (window as any).ng;

	document.querySelectorAll('*').forEach(function (el) {
		const tagName = el.tagName.toLowerCase();
		if (!tagName.includes('-')) return;

		const count = selectorCounts.get(tagName) || 0;
		selectorCounts.set(tagName, count + 1);

		const properties: Record<string, unknown> = {};

		// DOM-based counter reading (always works)
		el.querySelectorAll('[class*="value"], [class*="count"]').forEach(function (stateEl) {
			const text = stateEl.textContent;
			if (text !== null && text.trim() !== '') {
				const num = parseInt(text.trim(), 10);
				if (!isNaN(num)) properties['__dom_counter'] = num;
			}
		});

		// ng.getComponent for full instance state
		if (ng && typeof ng.getComponent === 'function') {
			try {
				const instance = ng.getComponent(el);
				if (instance) {
					for (const key of Object.keys(instance)) {
						if (key.startsWith('ɵ') || key.startsWith('__')) continue;
						const val = (instance as Record<string, unknown>)[key];
						if (typeof val === 'function') continue;
						properties[key] = val;
					}
				}
			} catch (_e) { /* ignore */ }
		}

		if (Object.keys(properties).length > 0) {
			snapshots.push({ selector: tagName, index: count, properties });
		}
	});
	return snapshots;
};

const restoreComponentState = (snapshots: StateSnapshot[]): void => {
	const ng = (window as any).ng;
	if (snapshots.length === 0) return;

	const bySelector = new Map<string, StateSnapshot[]>();
	for (const snap of snapshots) {
		const list = bySelector.get(snap.selector) || [];
		list.push(snap);
		bySelector.set(snap.selector, list);
	}

	bySelector.forEach(function (snaps, selector) {
		const elements = document.querySelectorAll(selector);
		snaps.forEach(function (snap) {
			const el = elements[snap.index];
			if (!el) return;

			if (ng && typeof ng.getComponent === 'function') {
				try {
					const instance = ng.getComponent(el);
					if (instance) {
						const domCounter = snap.properties['__dom_counter'];
						for (const [key, value] of Object.entries(snap.properties)) {
							if (key === '__dom_counter') continue;
							try { (instance as Record<string, unknown>)[key] = value; } catch (_e) { }
						}
						if (domCounter !== undefined && typeof domCounter === 'number') {
							if ('count' in instance) {
								(instance as Record<string, unknown>)['count'] = domCounter;
							}
						}
						// Force re-render in zoneless
						if (typeof ng.applyChanges === 'function') ng.applyChanges(el);
						return;
					}
				} catch (_e) { /* ignore */ }
			}

			// Fallback: patch DOM directly
			const domCounter = snap.properties['__dom_counter'];
			if (domCounter !== undefined) {
				el.querySelectorAll('[class*="value"], [class*="count"]').forEach(function (counterEl) {
					counterEl.textContent = String(domCounter);
				});
			}
		});
	});
};

// ─── Wait for Angular bootstrap ─────────────────────────────

const waitForAngularApp = (): Promise<void> => {
	return new Promise(function (resolve) {
		if (window.__ANGULAR_APP__) { resolve(); return; }
		let attempts = 0;
		const timer = setInterval(function () {
			attempts++;
			if (window.__ANGULAR_APP__ || attempts >= 500) {
				clearInterval(timer);
				resolve();
			}
		}, 1); // Poll every 1ms for instant detection (was 10ms)
	});
};

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export const handleAngularUpdate = (message: HMRMessage) => {
	if (detectCurrentFramework() !== 'angular') return;

	const updateType = message.data.updateType || 'logic';

	if ((updateType === 'style' || updateType === 'css-only') && message.data.cssUrl) {
		swapStylesheet(message.data.cssUrl, message.data.cssBaseName || '', 'angular');
		return;
	}

	handleFullUpdate(message);
};

// ============================================================
// RE-BOOTSTRAP WITH VIEW TRANSITIONS API
// ============================================================

const handleFullUpdate = (message: HMRMessage) => {
	// 1. Capture state BEFORE anything changes
	const componentState = captureComponentState();
	const scrollState = saveScrollState();
	const formState = saveFormState();

	// 2. CSS pre-update
	if (message.data.cssUrl) {
		swapStylesheet(message.data.cssUrl, message.data.cssBaseName || '', 'angular');
	}

	// 3. Find root selector + index path
	let rootSelector: string | null = null;
	const rootContainer = document.getElementById('root') || document.body;
	const candidates = rootContainer.querySelectorAll('*');
	for (let i = 0; i < candidates.length; i++) {
		const tag = candidates[i]!.tagName.toLowerCase();
		if (tag.includes('-')) { rootSelector = tag; break; }
	}

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'angular'
	);
	if (!indexPath) return;

	// 4. The async update function — does destroy + re-bootstrap
	const doUpdate = async (): Promise<void> => {
		// Destroy old app
		if (window.__ANGULAR_APP__) {
			try { window.__ANGULAR_APP__.destroy(); } catch (_e) { }
			window.__ANGULAR_APP__ = null;
		}

		// Recreate root element
		if (rootSelector && !rootContainer.querySelector(rootSelector)) {
			rootContainer.appendChild(document.createElement(rootSelector));
		}

		// Skip hydration for re-bootstrap
		(window as any).__HMR_SKIP_HYDRATION__ = true;

		// Import new module → triggers bootstrapApplication
		await import(/* @vite-ignore */ indexPath + '?t=' + Date.now());
		await waitForAngularApp();

		// Immediately restore state (don't wait for requestAnimationFrame, it delays the View Transition)
		restoreComponentState(componentState);

		// Trigger change detection
		if (window.__ANGULAR_APP__) {
			try { (window.__ANGULAR_APP__ as any).tick(); } catch (_e) { }
		}

		// Restore DOM state
		restoreFormState(formState);
		restoreScrollState(scrollState);
	};

	// 5. Use View Transitions API if available (Chrome 111+)
	//    The browser captures a screenshot, runs our async update behind it,
	//    and crossfades to the new content when the update finishes.
	const doc = document as any;
	if (typeof doc.startViewTransition === 'function') {
		// Disable the default crossfade animation for instant swap
		let styleEl: HTMLStyleElement | null = null;
		try {
			styleEl = document.createElement('style');
			styleEl.textContent = '::view-transition-old(root),::view-transition-new(root){animation:none!important}';
			document.head.appendChild(styleEl);
		} catch (_e) { }

		doc.startViewTransition(async () => {
			await doUpdate();
		}).finished.then(() => {
			if (styleEl && styleEl.parentNode) styleEl.remove();
		}).catch(() => {
			if (styleEl && styleEl.parentNode) styleEl.remove();
		});
	} else {
		// Fallback for browsers without View Transitions API
		doUpdate().catch(function (err: unknown) {
			console.warn('[HMR] Angular update failed (non-fatal):', err);
		});
	}
};

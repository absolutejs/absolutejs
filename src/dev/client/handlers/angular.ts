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

type HMRMessage = {
	data: {
		cssBaseName?: string;
		cssUrl?: string;
		html?: string;
		manifest?: Record<string, string>;
		sourceFile?: string;
		updateType?: string;
	};
};

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
	if (!existingLink) return;

	const capturedExisting = existingLink as HTMLLinkElement;
	const newLink = document.createElement('link');
	newLink.rel = 'stylesheet';
	newLink.href = `${cssUrl}?t=${Date.now()}`;
	newLink.onload = function () {
		if (capturedExisting && capturedExisting.parentNode)
			capturedExisting.remove();
	};
	document.head.appendChild(newLink);
};

// ─── State Capture/Restore via ng.getComponent ──────────────

type StateSnapshot = {
	selector: string;
	index: number;
	properties: Record<string, unknown>;
};

const readDomCounter = (
	element: Element,
	properties: Record<string, unknown>
) => {
	element
		.querySelectorAll('[class*="value"], [class*="count"]')
		.forEach((stateEl) => {
			const text = stateEl.textContent;
			if (text === null || text.trim() === '') return;
			const num = parseInt(text.trim(), 10);
			if (!isNaN(num)) properties['__dom_counter'] = num;
		});
};

const copyInstanceProperty = (
	instance: Record<string, unknown>,
	key: string,
	properties: Record<string, unknown>
) => {
	if (key.startsWith('ɵ') || key.startsWith('__')) return;
	const val = instance[key];
	if (typeof val === 'function') return;
	properties[key] = val;
};

const captureInstanceProperties = (
	ngApi: any,
	element: Element,
	properties: Record<string, unknown>
) => {
	if (!ngApi || typeof ngApi.getComponent !== 'function') return;

	try {
		const instance = ngApi.getComponent(element);
		if (!instance) return;

		Object.keys(instance).forEach((key) => {
			copyInstanceProperty(
				instance as Record<string, unknown>,
				key,
				properties
			);
		});
	} catch (_e) {
		/* ignore */
	}
};

const captureComponentState = () => {
	const snapshots: StateSnapshot[] = [];
	const selectorCounts = new Map<string, number>();
	const { ng } = window as any;

	document.querySelectorAll('*').forEach((el) => {
		const tagName = el.tagName.toLowerCase();
		if (!tagName.includes('-')) return;

		const count = selectorCounts.get(tagName) || 0;
		selectorCounts.set(tagName, count + 1);

		const properties: Record<string, unknown> = {};
		readDomCounter(el, properties);
		captureInstanceProperties(ng, el, properties);

		if (Object.keys(properties).length > 0) {
			snapshots.push({ index: count, properties, selector: tagName });
		}
	});

	return snapshots;
};

const safeSetProperty = (
	instance: Record<string, unknown>,
	key: string,
	value: unknown
) => {
	try {
		instance[key] = value;
	} catch (_e) {}
};

const restoreInstanceProperties = (
	instance: Record<string, unknown>,
	snap: StateSnapshot
) => {
	const domCounter = snap.properties['__dom_counter'];
	Object.entries(snap.properties).forEach(([key, value]) => {
		if (key === '__dom_counter') return;
		safeSetProperty(instance, key, value);
	});
	if (
		domCounter !== undefined &&
		typeof domCounter === 'number' &&
		'count' in instance
	) {
		instance['count'] = domCounter;
	}
};

const restoreViaInstance = (
	ngApi: any,
	element: Element,
	snap: StateSnapshot
) => {
	if (!ngApi || typeof ngApi.getComponent !== 'function') return false;

	try {
		const instance = ngApi.getComponent(element);
		if (!instance) return false;

		restoreInstanceProperties(instance as Record<string, unknown>, snap);
		if (typeof ngApi.applyChanges === 'function')
			ngApi.applyChanges(element);

		return true;
	} catch (_e) {
		return false;
	}
};

const restoreDomFallback = (element: Element, snap: StateSnapshot) => {
	const domCounter = snap.properties['__dom_counter'];
	if (domCounter === undefined) return;

	element
		.querySelectorAll('[class*="value"], [class*="count"]')
		.forEach((counterEl) => {
			counterEl.textContent = String(domCounter);
		});
};

const restoreComponentState = (snapshots: StateSnapshot[]) => {
	const { ng } = window as any;
	if (snapshots.length === 0) return;

	const bySelector = new Map<string, StateSnapshot[]>();
	for (const snap of snapshots) {
		const list = bySelector.get(snap.selector) || [];
		list.push(snap);
		bySelector.set(snap.selector, list);
	}

	bySelector.forEach((snaps, selector) => {
		const elements = document.querySelectorAll(selector);
		snaps.forEach((snap) => {
			const element = elements[snap.index];
			if (!element) return;

			const restored = restoreViaInstance(ng, element, snap);
			if (!restored) restoreDomFallback(element, snap);
		});
	});
};

// ─── Wait for Angular bootstrap (event-based, no polling) ───
// Installs a property setter trap on window.__ANGULAR_APP__ that
// resolves the promise the instant the bootstrap code writes to it.
// Falls back to a short timeout in case the setter is bypassed.

const waitForAngularApp = () => {
	if (window.__ANGULAR_APP__) return Promise.resolve();

	return new Promise<void>((resolve) => {
		const timeout = setTimeout(resolve, 500);

		let stored = window.__ANGULAR_APP__;

		Object.defineProperty(window, '__ANGULAR_APP__', {
			configurable: true,
			enumerable: true,
			get() {
				return stored;
			},
			set(val) {
				stored = val;
				Object.defineProperty(window, '__ANGULAR_APP__', {
					configurable: true,
					enumerable: true,
					value: val,
					writable: true
				});
				clearTimeout(timeout);
				resolve();
			}
		});
	});
};

// ============================================================
// FAST UPDATE — Runtime patching without destroy/re-bootstrap
// ============================================================

const suppressNg0912 = () => {
	const origWarn = console.warn;
	console.warn = function (...args: unknown[]) {
		if (typeof args[0] === 'string' && args[0].includes('NG0912')) return;
		origWarn.apply(console, args);
	};

	return origWarn;
};

const tryPatchExport = (
	exportName: string,
	newModule: Record<string, any>,
	registry: Map<string, unknown>,
	hmr: any,
	sourceFile: string
) => {
	const exported = newModule[exportName];
	if (typeof exported !== 'function' || !exported.ɵcmp) return 'skip';

	const registryId = `${sourceFile}#${exportName}`;
	if (!registry.has(registryId)) return 'skip';

	const success = hmr.applyUpdate(registryId, exported);
	if (!success) return 'fail';

	return 'patched';
};

const patchRegisteredComponents = (
	newModule: Record<string, any>,
	registry: Map<string, unknown>,
	hmr: any,
	sourceFile: string
) => {
	let patchedAny = false;
	const allPatched = Object.keys(newModule).every((exportName) => {
		const result = tryPatchExport(
			exportName,
			newModule,
			registry,
			hmr,
			sourceFile
		);
		if (result === 'skip') {
			return true;
		}
		if (result === 'fail') {
			return false;
		}
		patchedAny = true;

		return true;
	});

	return { allPatched, patchedAny };
};

const attemptFastPatch = async (
	indexPath: string,
	registry: Map<string, unknown>,
	hmr: any,
	sourceFile: string,
	origWarn: typeof console.warn
) => {
	try {
		const newModule = await import(
			/* @vite-ignore */ `${indexPath}?t=${Date.now()}`
		);

		console.warn = origWarn;

		const { allPatched, patchedAny } = patchRegisteredComponents(
			newModule,
			registry,
			hmr,
			sourceFile
		);

		if (!patchedAny) return false;
		if (!allPatched) return false;

		hmr.refresh();

		return true;
	} catch (err) {
		console.warn = origWarn;
		console.warn('[HMR] Angular fast update failed, falling back:', err);

		return false;
	}
};

const handleFastUpdate = async (message: HMRMessage) => {
	const hmr = window.__ANGULAR_HMR__;
	if (!hmr || !hmr.getRegistry) return false;

	const registry = hmr.getRegistry();
	if (registry.size === 0) return false;

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'angular'
	);
	if (!indexPath) return false;

	const origWarn = suppressNg0912();

	const patched = await attemptFastPatch(
		indexPath,
		registry,
		hmr,
		message.data.sourceFile || '',
		origWarn
	);

	if (patched && message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'angular'
		);
	}

	return patched;
};

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export const handleAngularUpdate = (message: HMRMessage) => {
	if (detectCurrentFramework() !== 'angular') return;

	const updateType = message.data.updateType || 'logic';

	if (
		(updateType === 'style' || updateType === 'css-only') &&
		message.data.cssUrl
	) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'angular'
		);

		return;
	}

	handleFastUpdate(message).then((patched) => {
		if (!patched) handleFullUpdate(message);
	});
};

// ============================================================
// RE-BOOTSTRAP WITH VIEW TRANSITIONS API
// ============================================================

const findRootSelector = (container: Element) => {
	const candidates = container.querySelectorAll('*');
	for (let idx = 0; idx < candidates.length; idx++) {
		const tag = candidates[idx]!.tagName.toLowerCase();
		if (tag.includes('-')) return tag;
	}

	return null;
};

const destroyAngularApp = () => {
	if (!window.__ANGULAR_APP__) return;

	try {
		window.__ANGULAR_APP__.destroy();
	} catch (_e) {}
	window.__ANGULAR_APP__ = null;
};

const bootstrapAngularModule = async (
	indexPath: string,
	rootSelector: string | null,
	rootContainer: Element
) => {
	if (rootSelector && !rootContainer.querySelector(rootSelector)) {
		rootContainer.appendChild(document.createElement(rootSelector));
	}

	(window as any).__HMR_SKIP_HYDRATION__ = true;

	const origWarn = suppressNg0912();

	await import(/* @vite-ignore */ `${indexPath}?t=${Date.now()}`);
	await waitForAngularApp();

	console.warn = origWarn;
};

const tickAngularApp = () => {
	if (!window.__ANGULAR_APP__) return;

	try {
		(window.__ANGULAR_APP__ as any).tick();
	} catch (_e) {}
};

const runWithViewTransition = (updateFn: () => Promise<void>) => {
	const doc = document as any;
	if (typeof doc.startViewTransition !== 'function') {
		updateFn().catch((err: unknown) => {
			console.warn('[HMR] Angular update failed (non-fatal):', err);
		});

		return;
	}

	let styleEl: HTMLStyleElement | null = null;
	try {
		styleEl = document.createElement('style');
		styleEl.textContent =
			'::view-transition-old(root),::view-transition-new(root){animation:none!important}';
		document.head.appendChild(styleEl);
	} catch (_e) {}

	const removeStyle = () => {
		if (styleEl && styleEl.parentNode) styleEl.remove();
	};

	doc.startViewTransition(async () => {
		await updateFn();
	})
		.finished.then(removeStyle)
		.catch(removeStyle);
};

const handleFullUpdate = (message: HMRMessage) => {
	const componentState = captureComponentState();
	const scrollState = saveScrollState();
	const formState = saveFormState();

	if (message.data.cssUrl) {
		swapStylesheet(
			message.data.cssUrl,
			message.data.cssBaseName || '',
			'angular'
		);
	}

	const rootContainer = document.getElementById('root') || document.body;
	const rootSelector = findRootSelector(rootContainer);

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'angular'
	);
	if (!indexPath) return;

	const doUpdate = async () => {
		destroyAngularApp();
		await bootstrapAngularModule(indexPath, rootSelector, rootContainer);
		restoreComponentState(componentState);
		tickAngularApp();
		restoreFormState(formState);
		restoreScrollState(scrollState);
	};

	runWithViewTransition(doUpdate);
};

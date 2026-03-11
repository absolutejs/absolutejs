/* Vue HMR update handler */

import { saveDOMState, restoreDOMState } from '../domState';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';

/* Local Vue internal types (avoids importing Vue) */
type VueVNode = {
	children?: VueVNode[];
	component?: VueComponentInstance;
};

type VueComponentInstance = {
	setupState?: Record<string, unknown>;
	subTree?: VueVNode;
};

/* Collect reactive value from a setup state entry into the target record */
const collectSetupValue = (
	target: Record<string, unknown>,
	key: string,
	value: unknown
) => {
	if (
		value &&
		typeof value === 'object' &&
		'value' in (value as Record<string, unknown>)
	) {
		target[key] = (value as { value: unknown }).value;

		return;
	}

	if (typeof value !== 'function') {
		target[key] = value;
	}
};

/* Copy all setup state entries from a record into the target */
const collectSetupState = (
	target: Record<string, unknown>,
	setupState: Record<string, unknown>
) => {
	const keys = Object.keys(setupState);
	for (let idx = 0; idx < keys.length; idx++) {
		const key = keys[idx]!;
		collectSetupValue(target, key, setupState[key]);
	}
};

/* Walk a VNode tree and collect setup state from all child components */
const walkVNode = (
	vnode: VueVNode | undefined,
	state: Record<string, unknown>
) => {
	if (!vnode) return;

	if (vnode.component && vnode.component.setupState) {
		collectSetupState(state, vnode.component.setupState);
	}

	if (vnode.children && Array.isArray(vnode.children)) {
		vnode.children.forEach((child) => {
			walkVNode(child, state);
		});
	}

	if (vnode.component && vnode.component.subTree) {
		walkVNode(vnode.component.subTree, state);
	}
};

/* Extract state from child Vue component instances recursively */
const extractChildComponentState = (
	instance: VueComponentInstance,
	state: Record<string, unknown>
) => {
	if (!instance || !instance.subTree) return;

	walkVNode(instance.subTree, state);
};

/* Find an existing stylesheet link matching the given base name */
const findMatchingStylesheetLink = (cssBaseName: string) => {
	let found: HTMLLinkElement | null = null;
	document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
		const href = (link as HTMLLinkElement).getAttribute('href') || '';
		if (cssBaseName && href.includes(cssBaseName)) {
			found = link as HTMLLinkElement;
		}
	});

	return found;
};

/* Swap a stylesheet link with a new one, removing the old on load */
const swapStylesheet = (cssUrl: string, cssBaseName: string) => {
	const existingLink = findMatchingStylesheetLink(cssBaseName);
	if (!existingLink) return;

	const capturedExisting = existingLink as HTMLLinkElement;
	const newLink = document.createElement('link');
	newLink.rel = 'stylesheet';
	newLink.href = `${cssUrl}?t=${Date.now()}`;
	newLink.onload = function () {
		if (capturedExisting && capturedExisting.parentNode) {
			capturedExisting.remove();
		}
	};
	document.head.appendChild(newLink);
};

/* Extract Vue reactive state from app instance */
const extractVueAppState = (vuePreservedState: Record<string, unknown>) => {
	if (!window.__VUE_APP__ || !window.__VUE_APP__._instance) return;

	const instance = window.__VUE_APP__._instance;

	if (instance.setupState) {
		collectSetupState(vuePreservedState, instance.setupState);
	}

	extractChildComponentState(
		instance as VueComponentInstance,
		vuePreservedState
	);
};

/* DOM fallback: extract count from button text when app instance is unavailable */
const extractCountFromDOM = (vuePreservedState: Record<string, unknown>) => {
	if (Object.keys(vuePreservedState).length > 0) return;

	const countButton = document.querySelector('button');
	if (!countButton || !countButton.textContent) return;

	const countMatch = countButton.textContent.match(/count is (\d+)/i);
	if (!countMatch) return;

	vuePreservedState.initialCount = parseInt(countMatch[1]!, 10);
};

/* Handle completion of Vue module reimport */
const handleVueImportSuccess = (
	vueRoot: HTMLElement | null,
	vueDomState: ReturnType<typeof saveDOMState> | null
) => {
	if (vueRoot && vueDomState) {
		restoreDOMState(vueRoot, vueDomState);
	}
	sessionStorage.removeItem('__HMR_ACTIVE__');
};

export const handleVueUpdate = (message: {
	data: {
		cssBaseName?: string;
		cssUrl?: string;
		html?: string;
		manifest?: Record<string, string>;
		sourceFile?: string;
		updateType?: string;
	};
}) => {
	const vueFrameworkCheck = detectCurrentFramework();
	if (vueFrameworkCheck !== 'vue') return;

	if (message.data.updateType === 'css-only' && message.data.cssUrl) {
		swapStylesheet(message.data.cssUrl, message.data.cssBaseName || '');

		return;
	}

	sessionStorage.setItem('__HMR_ACTIVE__', 'true');

	const vueRoot = document.getElementById('root');
	const vueDomState = vueRoot ? saveDOMState(vueRoot) : null;

	/* Extract Vue reactive state from app instance (not DOM) */
	const vuePreservedState: Record<string, unknown> = {};

	extractVueAppState(vuePreservedState);

	/* DOM fallback if app instance not available */
	extractCountFromDOM(vuePreservedState);

	/* Map count -> initialCount for prop-based state (used by CountButton) */
	if (
		vuePreservedState.count !== undefined &&
		vuePreservedState.initialCount === undefined
	) {
		vuePreservedState.initialCount = vuePreservedState.count;
	}

	/* Backup to sessionStorage for resilience */
	try {
		sessionStorage.setItem(
			'__VUE_HMR_STATE__',
			JSON.stringify(vuePreservedState)
		);
	} catch (_err) {
		/* ignore */
	}

	window.__HMR_PRESERVED_STATE__ = vuePreservedState;

	/* CSS pre-update: swap stylesheet BEFORE unmounting to prevent FOUC */
	if (message.data.cssUrl) {
		swapStylesheet(message.data.cssUrl, message.data.cssBaseName || '');
	}

	/* Unmount old Vue app but keep DOM visually intact during async import.
	   unmount() clears the container — snapshot and restore synchronously. */
	const savedHTML = vueRoot ? vueRoot.innerHTML : '';
	if (window.__VUE_APP__) {
		window.__VUE_APP__.unmount();
		window.__VUE_APP__ = null;
	}
	if (vueRoot) {
		vueRoot.innerHTML = savedHTML;
	}

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.sourceFile,
		'vue'
	);
	if (!indexPath) {
		console.warn('[HMR] Vue index path not found, reloading');
		window.location.reload();

		return;
	}

	const modulePath = `${indexPath}?t=${Date.now()}`;
	import(modulePath)
		.then(() => {
			handleVueImportSuccess(vueRoot, vueDomState);
		})
		.catch((err: unknown) => {
			console.warn('[HMR] Vue import failed:', err);
			sessionStorage.removeItem('__HMR_ACTIVE__');
			window.location.reload();
		});
};

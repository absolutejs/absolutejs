/* Vue HMR update handler */

import type { VueComponentInstance, VueVNode } from '../../../../types/vue';
import { saveDOMState, restoreDOMState } from '../domState';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';

/* Collect reactive value from a setup state entry into the target record */
const collectSetupValue = (
	target: Record<string, unknown>,
	key: string,
	value: unknown
) => {
	if (value && typeof value === 'object' && 'value' in value) {
		target[key] = value.value;

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
		const key = keys[idx];
		if (key === undefined) continue;
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
	document
		.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
		.forEach((link) => {
			const href = link.getAttribute('href') ?? '';
			if (cssBaseName && href.includes(cssBaseName)) {
				found = link;
			}
		});

	return found;
};

/* Swap a stylesheet link with a new one, removing the old on load */
const swapStylesheet = (cssUrl: string, cssBaseName: string) => {
	const existingLink = findMatchingStylesheetLink(cssBaseName);
	if (!existingLink) return;

	const capturedExisting: HTMLLinkElement = existingLink;
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

	extractChildComponentState(instance, vuePreservedState);
};

/* DOM fallback: extract count from button text when app instance is unavailable */
const extractCountFromDOM = (vuePreservedState: Record<string, unknown>) => {
	if (Object.keys(vuePreservedState).length > 0) return;

	const countButton = document.querySelector('button');
	if (!countButton || !countButton.textContent) return;

	const countMatch = countButton.textContent.match(/count is (\d+)/i);
	if (!countMatch) return;

	vuePreservedState.initialCount = parseInt(countMatch[1] ?? '0', 10);
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

/* Force-reload a Vue component via HMR runtime when setup() must re-run */
const forceReloadVueComponent = (mod: Record<string, unknown>) => {
	const hmrRuntime = window.__VUE_HMR_RUNTIME__;
	if (!hmrRuntime) return;

	const component = mod?.default ?? Object.values(mod ?? {})[0];
	if (!component || typeof component !== 'object') return;
	if (!('__hmrId' in component)) return;

	const { __hmrId: hmrId } = component;
	if (typeof hmrId === 'string') {
		hmrRuntime.reload(hmrId, component);
	}
};

export const handleVueUpdate = (message: {
	data: {
		cssBaseName?: string;
		cssUrl?: string;
		forceReload?: boolean;
		html?: string;
		manifest?: Record<string, string>;
		pageModuleUrl?: string;
		serverDuration?: number;
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
	} catch {
		/* ignore */
	}

	window.__HMR_PRESERVED_STATE__ = vuePreservedState;

	// O(1) Vue HMR: import the changed module directly.
	// __VUE_HMR_RUNTIME__.reload() inside the module hot-swaps the
	// component in place — same pattern as React Fast Refresh.
	const { pageModuleUrl } = message.data;
	if (pageModuleUrl) {
		const clientStart = performance.now();
		const modulePath = `${pageModuleUrl}?t=${Date.now()}`;

		import(modulePath)
			.then((mod) => {
				// When a composable/utility file changed (not the .vue file itself),
				// force reload via __VUE_HMR_RUNTIME__ so setup() re-runs.
				// Vue's rerender only swaps the template, not the setup closure.
				if (message.data.forceReload) {
					forceReloadVueComponent(mod);
				}
				sessionStorage.removeItem('__HMR_ACTIVE__');

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
				console.warn('[HMR] Vue HMR failed, reloading:', err);
				sessionStorage.removeItem('__HMR_ACTIVE__');
				window.location.reload();
			});

		return;
	}

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

	// Bundled fallback: re-import the index file
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

			return undefined;
		})
		.catch((err: unknown) => {
			console.warn('[HMR] Vue import failed:', err);
			sessionStorage.removeItem('__HMR_ACTIVE__');
			window.location.reload();
		});
};

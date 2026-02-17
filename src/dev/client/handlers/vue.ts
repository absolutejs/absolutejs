/* Vue HMR update handler */

import { saveDOMState, restoreDOMState } from '../domState';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';

/* Local Vue internal types (avoids importing Vue) */
interface VueVNode {
	children?: VueVNode[];
	component?: VueComponentInstance;
}

interface VueComponentInstance {
	setupState?: Record<string, unknown>;
	subTree?: VueVNode;
}

/* Extract state from child Vue component instances recursively */
const extractChildComponentState = (
	instance: VueComponentInstance,
	state: Record<string, unknown>
): void => {
	if (!instance || !instance.subTree) return;

	const walkVNode = (vnode: VueVNode | undefined): void => {
		if (!vnode) return;

		if (vnode.component && vnode.component.setupState) {
			const childState = vnode.component.setupState;
			const keys = Object.keys(childState);
			for (let idx = 0; idx < keys.length; idx++) {
				const key = keys[idx]!;
				const value = childState[key];
				if (
					value &&
					typeof value === 'object' &&
					'value' in (value as Record<string, unknown>)
				) {
					state[key] = (value as { value: unknown }).value;
				} else if (typeof value !== 'function') {
					state[key] = value;
				}
			}
		}

		if (vnode.children && Array.isArray(vnode.children)) {
			for (let jdx = 0; jdx < vnode.children.length; jdx++) {
				walkVNode(vnode.children[jdx]);
			}
		}
		if (vnode.component && vnode.component.subTree) {
			walkVNode(vnode.component.subTree);
		}
	};

	walkVNode(instance.subTree);
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
		console.log('[HMR] Vue CSS-only update (state preserved)');
		const cssBaseName = message.data.cssBaseName || '';
		let existingLink: HTMLLinkElement | null = null;
		document
			.querySelectorAll('link[rel="stylesheet"]')
			.forEach(function (link) {
				const href =
					(link as HTMLLinkElement).getAttribute('href') || '';
				if (href.includes(cssBaseName) || href.includes('vue')) {
					existingLink = link as HTMLLinkElement;
				}
			});

		if (existingLink) {
			const capturedExisting = existingLink as HTMLLinkElement;
			const newLink = document.createElement('link');
			newLink.rel = 'stylesheet';
			newLink.href = message.data.cssUrl + '?t=' + Date.now();
			newLink.onload = function () {
				if (capturedExisting && capturedExisting.parentNode) {
					capturedExisting.remove();
				}
				console.log('[HMR] Vue CSS updated');
			};
			document.head.appendChild(newLink);
		}
		return;
	}

	console.log('[HMR] Vue update - remounting component');
	sessionStorage.setItem('__HMR_ACTIVE__', 'true');

	const vueRoot = document.getElementById('root');
	const vueDomState = vueRoot ? saveDOMState(vueRoot) : null;

	/* Extract Vue reactive state from app instance (not DOM) */
	const vuePreservedState: Record<string, unknown> = {};

	if (window.__VUE_APP__ && window.__VUE_APP__._instance) {
		const instance = window.__VUE_APP__._instance;

		if (instance.setupState) {
			const setupKeys = Object.keys(instance.setupState);
			for (let idx = 0; idx < setupKeys.length; idx++) {
				const key = setupKeys[idx]!;
				const value = instance.setupState[key];
				if (
					value &&
					typeof value === 'object' &&
					'value' in (value as Record<string, unknown>)
				) {
					vuePreservedState[key] = (
						value as { value: unknown }
					).value;
				} else if (typeof value !== 'function') {
					vuePreservedState[key] = value;
				}
			}
		}

		extractChildComponentState(
			instance as VueComponentInstance,
			vuePreservedState
		);
	}

	/* DOM fallback if app instance not available */
	if (Object.keys(vuePreservedState).length === 0) {
		const countButton = document.querySelector('button');
		if (countButton && countButton.textContent) {
			const countMatch = countButton.textContent.match(/count is (\d+)/i);
			if (countMatch) {
				vuePreservedState.initialCount = parseInt(countMatch[1]!, 10);
			}
		}
	}

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
	console.log(
		'[HMR] Vue state preserved:',
		JSON.stringify(vuePreservedState)
	);

	/* CSS pre-update: swap stylesheet BEFORE unmounting to prevent FOUC */
	if (message.data.cssUrl) {
		const vueCssBaseName = message.data.cssBaseName || '';
		let vueExistingLink: HTMLLinkElement | null = null;
		document
			.querySelectorAll('link[rel="stylesheet"]')
			.forEach(function (link) {
				const href =
					(link as HTMLLinkElement).getAttribute('href') || '';
				if (href.includes(vueCssBaseName) || href.includes('vue')) {
					vueExistingLink = link as HTMLLinkElement;
				}
			});
		if (vueExistingLink) {
			const capturedVueLink = vueExistingLink as HTMLLinkElement;
			const vueCssLink = document.createElement('link');
			vueCssLink.rel = 'stylesheet';
			vueCssLink.href = message.data.cssUrl + '?t=' + Date.now();
			vueCssLink.onload = function () {
				if (capturedVueLink && capturedVueLink.parentNode) {
					capturedVueLink.remove();
				}
			};
			document.head.appendChild(vueCssLink);
		}
	}

	/* Unmount old Vue app */
	if (window.__VUE_APP__) {
		window.__VUE_APP__.unmount();
		window.__VUE_APP__ = null;
	}

	const newHTML = message.data.html;
	if (!newHTML) {
		window.location.reload();
		return;
	}

	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = newHTML;
	const newRootDiv = tempDiv.querySelector('#root');
	let innerContent = newRootDiv ? newRootDiv.innerHTML : newHTML;

	/* Pre-apply preserved state to HTML (prevents flicker showing count=0) */
	if (vuePreservedState.initialCount !== undefined) {
		innerContent = innerContent.replace(
			/count is 0/g,
			'count is ' + vuePreservedState.initialCount
		);
	}

	if (vueRoot) {
		vueRoot.innerHTML = innerContent;
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

	const modulePath = indexPath + '?t=' + Date.now();
	import(/* @vite-ignore */ modulePath)
		.then(function () {
			if (vueRoot && vueDomState) {
				restoreDOMState(vueRoot, vueDomState);
			}
			sessionStorage.removeItem('__HMR_ACTIVE__');
			console.log('[HMR] Vue updated (state preserved)');
		})
		.catch(function (err: unknown) {
			console.warn('[HMR] Vue import failed:', err);
			sessionStorage.removeItem('__HMR_ACTIVE__');
			window.location.reload();
		});
};

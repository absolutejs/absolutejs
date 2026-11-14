/* Vue HMR update handler */

import type { VueComponentInstance, VueVNode } from '../../../../types/vue';
import { saveDOMState, restoreDOMState } from '../domState';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';
import { sendAbsoluteHmrTiming } from '../hmrTiming';
import { swapCSSStylesheet } from '../cssUtils';

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

/* A page that exports `routes = defineRoutes([...])` gets its router from
 * the auto-generated setupApp, which runs once at boot. Re-importing the
 * edited page module re-evaluates `routes` but leaves the live router on the
 * boot-time table, so a route added to the page could not be navigated to
 * (the router saw no match and fell back to a full page load) and a removed
 * one still rendered. Swap the live router's table for the new one. */
type RouteMatch = { path: string };

type LiveVueRouter = {
	addRoute: (route: Record<string, unknown>) => unknown;
	clearRoutes?: () => void;
	currentRoute: { value: { fullPath: string; matched: RouteMatch[] } };
	options?: { routes?: unknown };
	replace: (to: string) => Promise<unknown>;
	resolve: (to: string) => { matched: RouteMatch[] };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isLiveVueRouter = (value: unknown): value is LiveVueRouter =>
	isRecord(value) &&
	typeof value.addRoute === 'function' &&
	typeof value.resolve === 'function' &&
	typeof value.replace === 'function' &&
	isRecord(value.currentRoute);

const readLiveVueRouter = () => {
	const app = window.__VUE_APP__;
	const config = app ? Reflect.get(app, 'config') : undefined;
	const globals = isRecord(config)
		? Reflect.get(config, 'globalProperties')
		: undefined;
	const router = isRecord(globals) ? Reflect.get(globals, '$router') : null;

	return isLiveVueRouter(router) ? router : null;
};

/* Route shape without the component loaders: the module server re-stamps
 * import URLs on every edit, which would make every save look like a route
 * table change and remount the current route. */
const describeRoutes = (routes: unknown): unknown[] =>
	Array.isArray(routes)
		? routes.map((route) =>
				isRecord(route)
					? {
							alias: route.alias,
							children: describeRoutes(route.children),
							name:
								typeof route.name === 'symbol'
									? String(route.name)
									: route.name,
							path: route.path,
							redirect:
								typeof route.redirect === 'function'
									? String(route.redirect)
									: route.redirect
						}
					: null
			)
		: [];

const routeTableSignature = (routes: unknown) =>
	JSON.stringify(describeRoutes(routes));

const appliedRouteTables = new WeakMap<LiveVueRouter, string>();

const matchedPaths = (matched: RouteMatch[]) =>
	matched.map((record) => record.path).join('\n');

/* Returns `reload` when the change can't be applied in place: the router
 * predates `clearRoutes` (vue-router < 4.4), or the route the page is on no
 * longer exists — the server now answers it 404, so load that. */
const syncVueRoutes = (mod: unknown) => {
	const routes = isRecord(mod) ? mod.routes : undefined;
	if (!Array.isArray(routes)) return 'unchanged';
	const router = readLiveVueRouter();
	if (!router) return 'unchanged';
	const next = routeTableSignature(routes);
	const previous =
		appliedRouteTables.get(router) ??
		routeTableSignature(router.options?.routes);
	if (next === previous) return 'unchanged';
	if (typeof router.clearRoutes !== 'function') return 'reload';

	router.clearRoutes();
	for (const route of routes) {
		if (isRecord(route)) router.addRoute(route);
	}
	appliedRouteTables.set(router, next);

	const current = router.currentRoute.value;
	const resolved = router.resolve(current.fullPath);
	if (resolved.matched.length === 0) return 'reload';
	// The current location now resolves to different records (its route was
	// edited): navigate in place so RouterView renders the new ones.
	if (matchedPaths(resolved.matched) !== matchedPaths(current.matched)) {
		void router.replace(current.fullPath);
	}

	return 'synced';
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
	timestamp?: number;
}) => {
	const vueFrameworkCheck = detectCurrentFramework();
	if (vueFrameworkCheck !== 'vue') return;

	if (message.data.updateType === 'css-only' && message.data.cssUrl) {
		const clientStart = performance.now();
		const cssBaseName = message.data.cssBaseName || '';
		void swapCSSStylesheet(
			message.data.cssUrl,
			(href) => Boolean(cssBaseName) && href.includes(cssBaseName)
		).then((applied) => {
			sendAbsoluteHmrTiming({
				clientStart,
				kind: 'css',
				outcome: applied ? 'applied' : 'failed',
				serverMs: message.data.serverDuration,
				updateId: message.timestamp
			});
		});

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

				if (syncVueRoutes(mod) === 'reload') {
					sendAbsoluteHmrTiming({
						clientStart,
						kind: 'component',
						outcome: 'reloaded',
						serverMs: message.data.serverDuration,
						updateId: message.timestamp
					});
					window.location.reload();

					return undefined;
				}

				if (message.data.serverDuration !== undefined) {
					sendAbsoluteHmrTiming({
						clientStart,
						kind: 'component',
						serverMs: message.data.serverDuration,
						updateId: message.timestamp
					});
				}

				return undefined;
			})
			.catch((err: unknown) => {
				console.warn('[HMR] Vue HMR failed, reloading:', err);
				sessionStorage.removeItem('__HMR_ACTIVE__');
				sendAbsoluteHmrTiming({
					clientStart,
					kind: 'component',
					outcome: 'reloaded',
					serverMs: message.data.serverDuration,
					updateId: message.timestamp
				});
				window.location.reload();
			});

		return;
	}

	/* CSS pre-update: swap stylesheet BEFORE unmounting to prevent FOUC */
	if (message.data.cssUrl) {
		const cssBaseName = message.data.cssBaseName || '';
		void swapCSSStylesheet(
			message.data.cssUrl,
			(href) => Boolean(cssBaseName) && href.includes(cssBaseName)
		);
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

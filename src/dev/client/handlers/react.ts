/* React HMR update handler
   Uses React Fast Refresh to hot-swap components while preserving state.
   Code splitting ensures React lives in a shared chunk that stays cached,
   so dynamic import of the rebuilt entry reuses the same React instance. */

import { hideErrorOverlay } from '../errorOverlay';
import { detectCurrentFramework } from '../frameworkDetect';
import { sendAbsoluteHmrTiming } from '../hmrTiming';

const reloadReactPage = () => {
	const url = new URL(window.location.href);
	url.searchParams.set('__absolute_hmr', Date.now().toString());
	window.location.replace(url.href);
};

export const handleReactUpdate = (message: {
	data: {
		fastRefreshSupported?: boolean;
		hasCSSChanges?: boolean;
		hasComponentChanges?: boolean;
		manifest?: Record<string, string>;
		moduleUrls?: string[];
		pageModuleUrl?: string;
		pageModuleUrls?: Record<string, string>;
		primarySource?: string;
		serverDuration?: number;
	};
	timestamp?: number;
}) => {
	const currentFramework = detectCurrentFramework();
	if (currentFramework !== 'react') return;

	// BUN-REACT-REFRESH-LEGACY: the remount/reload fallback for a dev server on
	// stock Bun, which cannot emit React Fast Refresh registrations. Remove it,
	// and the fastRefreshSupported message field, once the minimum Bun has the fix.
	if (message.data.fastRefreshSupported === false) {
		// The remount re-renders the whole page, so it needs this page's
		// module; a changed child's module would be rendered as the page.
		const componentKey = window.__REACT_COMPONENT_KEY__;
		const pageUrls = message.data.pageModuleUrls;
		if (pageUrls && componentKey && !pageUrls[componentKey]) {
			// This edit does not reach the page on screen.
			return;
		}
		const remountUrl =
			pageUrls && componentKey
				? pageUrls[componentKey]
				: message.data.pageModuleUrl;
		const remount = window.__ABS_REACT_REMOUNT__;
		if (remountUrl && remount) {
			applyRemountImport(
				remountUrl,
				remount,
				message.data.serverDuration,
				message.timestamp
			);
		} else {
			const clientStart = performance.now();
			sendAbsoluteHmrTiming({
				clientStart,
				kind: 'component',
				outcome: 'reloaded',
				serverMs: message.data.serverDuration,
				updateId: message.timestamp
			});
			reloadReactPage();
		}

		return;
	}
	const refreshRuntime = window.$RefreshRuntime$;
	const { serverDuration } = message.data;
	const { pageModuleUrl } = message.data;
	const fallbackUrls = pageModuleUrl ? [pageModuleUrl] : [];
	const moduleUrls =
		message.data.moduleUrls && message.data.moduleUrls.length > 0
			? message.data.moduleUrls
			: fallbackUrls;

	if (moduleUrls.length > 0 && refreshRuntime) {
		applyRefreshImport(
			moduleUrls,
			refreshRuntime,
			serverDuration,
			message.timestamp
		);

		return;
	}

	// No module URL — shouldn't happen, but reload as safety fallback
	const clientStart = performance.now();
	sendAbsoluteHmrTiming({
		clientStart,
		kind: 'component',
		outcome: 'reloaded',
		serverMs: message.data.serverDuration,
		updateId: message.timestamp
	});
	window.location.reload();
};

const finishUpdate = (
	clientStart: number,
	serverDuration?: number,
	updateId?: number
) => {
	sendAbsoluteHmrTiming({
		clientStart,
		kind: 'component',
		serverMs: serverDuration,
		updateId
	});
	if (window.__ERROR_BOUNDARY__) {
		window.__ERROR_BOUNDARY__.reset();
	}
	hideErrorOverlay();
};

const applyRefreshImport = (
	moduleUrls: string[],
	refreshRuntime: { performReactRefresh: () => unknown },
	serverDuration?: number,
	updateId?: number
) => {
	const clientStart = performance.now();
	const stamp = Date.now();
	// Every edited module has to run before the refresh, or a page that
	// now renders a new child refreshes without it.
	Promise.all(moduleUrls.map((url) => import(`${url}?t=${stamp}`)))
		.then(() => {
			refreshRuntime.performReactRefresh();
			finishUpdate(clientStart, serverDuration, updateId);

			return undefined;
		})
		.catch((err) => {
			console.warn(
				'[HMR] React Fast Refresh failed, falling back to reload:',
				err
			);
			sendAbsoluteHmrTiming({
				clientStart,
				kind: 'component',
				outcome: 'reloaded',
				serverMs: serverDuration,
				updateId
			});
			window.location.reload();
		});
};

const applyRemountImport = (
	moduleUrl: string,
	remount: (module: Record<string, unknown>) => void,
	serverDuration?: number,
	updateId?: number
) => {
	const clientStart = performance.now();
	import(`${moduleUrl}?t=${Date.now()}`)
		.then((module) => {
			remount(module);
			finishUpdate(clientStart, serverDuration, updateId);

			return undefined;
		})
		.catch((err) => {
			console.warn(
				'[HMR] React remount failed, falling back to reload:',
				err
			);
			sendAbsoluteHmrTiming({
				clientStart,
				kind: 'component',
				outcome: 'reloaded',
				serverMs: serverDuration,
				updateId
			});
			reloadReactPage();
		});
};

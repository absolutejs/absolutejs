/* React HMR update handler
   Uses React Fast Refresh to hot-swap components while preserving state.
   Code splitting ensures React lives in a shared chunk that stays cached,
   so dynamic import of the rebuilt entry reuses the same React instance. */

import { hideErrorOverlay } from '../errorOverlay';
import { detectCurrentFramework } from '../frameworkDetect';
import { sendAbsoluteHmrTiming } from '../hmrTiming';
import {
	createReactUpdateQueue,
	type ReactUpdateTiming
} from './reactUpdateQueue';

const reloadReactPage = () => {
	const url = new URL(window.location.href);
	url.searchParams.set('__absolute_hmr', Date.now().toString());
	window.location.replace(url.href);
};

const isModuleRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const reportReloaded = (timings: ReactUpdateTiming[]) => {
	for (const timing of timings)
		sendAbsoluteHmrTiming({
			clientStart: timing.clientStart,
			kind: 'component',
			outcome: 'reloaded',
			serverMs: timing.serverDuration,
			updateId: timing.updateId
		});
};

/* One queue per page: an update that arrives while another is still
 * applying waits for it, and the newest modules are the ones applied (see
 * reactUpdateQueue.ts). */
const reactUpdates = createReactUpdateQueue({
	apply: (update, modules) => {
		if (update.kind === 'remount') {
			const [module] = modules;
			const remount = window.__ABS_REACT_REMOUNT__;
			if (!remount || !isModuleRecord(module))
				throw new Error('React remount is unavailable');
			remount(module);

			return;
		}
		const refreshRuntime = window.$RefreshRuntime$;
		if (!refreshRuntime)
			throw new Error('React Fast Refresh runtime is unavailable');
		// Every edited module has run by now, so a page that now renders a
		// new child refreshes with it.
		refreshRuntime.performReactRefresh();
	},
	importModule: (url) => import(url),
	onApplied: (_update, timings) => {
		for (const timing of timings)
			sendAbsoluteHmrTiming({
				clientStart: timing.clientStart,
				kind: 'component',
				serverMs: timing.serverDuration,
				updateId: timing.updateId
			});
		if (window.__ERROR_BOUNDARY__) {
			window.__ERROR_BOUNDARY__.reset();
		}
		hideErrorOverlay();
	},
	onFailed: (update, timings, error) => {
		console.warn(
			update.kind === 'remount'
				? '[HMR] React remount failed, falling back to reload:'
				: '[HMR] React Fast Refresh failed, falling back to reload:',
			error
		);
		reportReloaded(timings);
		if (update.kind === 'remount') reloadReactPage();
		else window.location.reload();
	}
});

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
	const clientStart = performance.now();
	const { serverDuration } = message.data;

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
		if (remountUrl && window.__ABS_REACT_REMOUNT__) {
			reactUpdates.enqueue(
				{
					kind: 'remount',
					moduleUrls: [remountUrl],
					serverDuration,
					updateId: message.timestamp
				},
				clientStart
			);
		} else {
			reportReloaded([
				{ clientStart, serverDuration, updateId: message.timestamp }
			]);
			reloadReactPage();
		}

		return;
	}
	const { pageModuleUrl } = message.data;
	const fallbackUrls = pageModuleUrl ? [pageModuleUrl] : [];
	const moduleUrls =
		message.data.moduleUrls && message.data.moduleUrls.length > 0
			? message.data.moduleUrls
			: fallbackUrls;

	if (moduleUrls.length > 0 && window.$RefreshRuntime$) {
		reactUpdates.enqueue(
			{
				kind: 'refresh',
				moduleUrls,
				serverDuration,
				updateId: message.timestamp
			},
			clientStart
		);

		return;
	}

	// No module URL — shouldn't happen, but reload as safety fallback
	reportReloaded([
		{ clientStart, serverDuration, updateId: message.timestamp }
	]);
	window.location.reload();
};

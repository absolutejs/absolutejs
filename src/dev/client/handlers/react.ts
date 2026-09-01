/* React HMR update handler
   Uses React Fast Refresh to hot-swap components while preserving state.
   Code splitting ensures React lives in a shared chunk that stays cached,
   so dynamic import of the rebuilt entry reuses the same React instance. */

import { hideErrorOverlay } from '../errorOverlay';
import { detectCurrentFramework } from '../frameworkDetect';
import { absoluteHmrDebug, sendAbsoluteHmrTiming } from '../hmrTiming';
import { swapCSSStylesheet } from '../cssUtils';

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
		pageModuleUrl?: string;
		primarySource?: string;
		serverDuration?: number;
	};
	timestamp?: number;
}) => {
	const currentFramework = detectCurrentFramework();
	absoluteHmrDebug('handleReactMessage', {
		currentFramework,
		fastRefreshSupported: message.data.fastRefreshSupported,
		hasComponentChanges: message.data.hasComponentChanges,
		hasCSSChanges: message.data.hasCSSChanges,
		hasPageModuleUrl: Boolean(message.data.pageModuleUrl),
		hasRemount: Boolean(window.__ABS_REACT_REMOUNT__)
	});
	if (currentFramework !== 'react') return;

	const hasComponentChanges = message.data.hasComponentChanges !== false;
	const hasCSSChanges = message.data.hasCSSChanges === true;
	const cssPath =
		message.data.manifest && message.data.manifest.ReactExampleCSS;
	if (!hasComponentChanges && hasCSSChanges && cssPath) {
		const clientStart = performance.now();
		void reloadReactCSS(cssPath).then((applied) => {
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
	if (message.data.fastRefreshSupported === false) {
		const { pageModuleUrl } = message.data;
		const remount = window.__ABS_REACT_REMOUNT__;
		if (pageModuleUrl && remount) {
			applyRemountImport(
				pageModuleUrl,
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

	if (pageModuleUrl && refreshRuntime) {
		applyRefreshImport(
			pageModuleUrl,
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
	moduleUrl: string,
	refreshRuntime: { performReactRefresh: () => unknown },
	serverDuration?: number,
	updateId?: number
) => {
	const clientStart = performance.now();
	import(`${moduleUrl}?t=${Date.now()}`)
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

const reloadReactCSS = (cssPath: string) =>
	swapCSSStylesheet(cssPath, (href) => {
		const hrefBase = (href.split('?')[0] ?? '').split('/').pop() ?? '';
		const cssPathBase =
			(cssPath.split('?')[0] ?? '').split('/').pop() ?? '';

		return (
			hrefBase === cssPathBase ||
			href.includes('react-example') ||
			cssPathBase.includes(hrefBase)
		);
	});

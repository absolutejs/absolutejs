/* React HMR update handler
   Uses React Fast Refresh to hot-swap components while preserving state.
   Code splitting ensures React lives in a shared chunk that stays cached,
   so dynamic import of the rebuilt entry reuses the same React instance. */

import { hideErrorOverlay } from '../errorOverlay';
import { detectCurrentFramework } from '../frameworkDetect';

export const handleReactUpdate = (message: {
	data: {
		dataModuleUrl?: string;
		hasCSSChanges?: boolean;
		hasComponentChanges?: boolean;
		manifest?: Record<string, string>;
		pageModuleUrl?: string;
		primarySource?: string;
		serverDuration?: number;
	};
}) => {
	const currentFramework = detectCurrentFramework();
	if (currentFramework !== 'react') return;

	const hasComponentChanges = message.data.hasComponentChanges !== false;
	const hasCSSChanges = message.data.hasCSSChanges === true;
	const cssPath =
		message.data.manifest && message.data.manifest.ReactExampleCSS;

	if (!hasComponentChanges && hasCSSChanges && cssPath) {
		reloadReactCSS(cssPath);

		return;
	}

	const refreshRuntime = window.$RefreshRuntime$;
	const serverDuration = message.data.serverDuration;
	const dataModuleUrl = message.data.dataModuleUrl;
	const pageModuleUrl = message.data.pageModuleUrl;

	// Non-component file: import the data file first (cache bust),
	// then re-import the page so the component re-renders.
	if (dataModuleUrl && pageModuleUrl && refreshRuntime) {
		applyDataThenPage(
			dataModuleUrl,
			pageModuleUrl,
			refreshRuntime,
			serverDuration
		);

		return;
	}

	if (pageModuleUrl && refreshRuntime) {
		applyRefreshImport(pageModuleUrl, refreshRuntime, serverDuration);

		return;
	}

	const componentKey = window.__REACT_COMPONENT_KEY__;
	const newUrl = componentKey && message.data.manifest?.[componentKey];

	if (newUrl && refreshRuntime) {
		applyRefreshImport(newUrl, refreshRuntime, serverDuration);

		return;
	}

	window.location.reload();
};

const sendTiming = (clientStart: number, serverDuration?: number) => {
	if (window.__HMR_WS__) {
		const clientMs = Math.round(performance.now() - clientStart);
		const total = (serverDuration ?? 0) + clientMs;
		window.__HMR_WS__.send(
			JSON.stringify({ duration: total, type: 'hmr-timing' })
		);
	}
	if (window.__ERROR_BOUNDARY__) {
		window.__ERROR_BOUNDARY__.reset();
	} else {
		hideErrorOverlay();
	}
};

const applyRefreshImport = (
	moduleUrl: string,
	refreshRuntime: { performReactRefresh: () => unknown },
	serverDuration?: number
) => {
	const clientStart = performance.now();
	import(`${moduleUrl}?t=${Date.now()}`)
		.then(() => {
			refreshRuntime.performReactRefresh();
			sendTiming(clientStart, serverDuration);

			return undefined;
		})
		.catch((err) => {
			console.warn(
				'[HMR] React Fast Refresh failed, falling back to reload:',
				err
			);
			window.location.reload();
		});
};

const applyDataThenPage = (
	dataUrl: string,
	pageUrl: string,
	refreshRuntime: { performReactRefresh: () => unknown },
	serverDuration?: number
) => {
	const clientStart = performance.now();
	// Import the changed data file first to bust the browser cache,
	// then re-import the page so the component re-renders with new data.
	import(`${dataUrl}?t=${Date.now()}`)
		.then(() => import(`${pageUrl}?t=${Date.now()}`))
		.then(() => {
			refreshRuntime.performReactRefresh();
			sendTiming(clientStart, serverDuration);

			return undefined;
		})
		.catch((err) => {
			console.warn(
				'[HMR] React Fast Refresh failed, falling back to reload:',
				err
			);
			window.location.reload();
		});
};

const reloadReactCSS = (cssPath: string) => {
	const existingCSSLinks = document.head.querySelectorAll<HTMLLinkElement>(
		'link[rel="stylesheet"]'
	);
	existingCSSLinks.forEach((link) => {
		const href = link.getAttribute('href');
		if (!href) {
			return;
		}
		const hrefBase = (href.split('?')[0] ?? '').split('/').pop() ?? '';
		const cssPathBase =
			(cssPath.split('?')[0] ?? '').split('/').pop() ?? '';
		if (
			hrefBase === cssPathBase ||
			href.includes('react-example') ||
			cssPathBase.includes(hrefBase)
		) {
			const newHref = `${
				cssPath + (cssPath.includes('?') ? '&' : '?')
			}t=${Date.now()}`;
			link.href = newHref;
		}
	});
};

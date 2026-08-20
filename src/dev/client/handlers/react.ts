/* React HMR update handler
   Uses React Fast Refresh to hot-swap components while preserving state.
   Code splitting ensures React lives in a shared chunk that stays cached,
   so dynamic import of the rebuilt entry reuses the same React instance. */

import { hideErrorOverlay } from '../errorOverlay';
import { detectCurrentFramework } from '../frameworkDetect';

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
}) => {
	const currentFramework = detectCurrentFramework();
	if (currentFramework !== 'react') return;

	const hasComponentChanges = message.data.hasComponentChanges !== false;
	const hasCSSChanges = message.data.hasCSSChanges === true;
	if (message.data.fastRefreshSupported === false) {
		const { pageModuleUrl } = message.data;
		const remount = window.__ABS_REACT_REMOUNT__;
		if (pageModuleUrl && remount) {
			applyRemountImport(
				pageModuleUrl,
				remount,
				message.data.serverDuration
			);
		} else {
			reloadReactPage();
		}

		return;
	}
	const cssPath =
		message.data.manifest && message.data.manifest.ReactExampleCSS;

	if (!hasComponentChanges && hasCSSChanges && cssPath) {
		reloadReactCSS(cssPath);

		return;
	}

	const refreshRuntime = window.$RefreshRuntime$;
	const { serverDuration } = message.data;
	const { pageModuleUrl } = message.data;

	if (pageModuleUrl && refreshRuntime) {
		applyRefreshImport(pageModuleUrl, refreshRuntime, serverDuration);

		return;
	}

	// No module URL — shouldn't happen, but reload as safety fallback
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

const applyRemountImport = (
	moduleUrl: string,
	remount: (module: Record<string, unknown>) => void,
	serverDuration?: number
) => {
	const clientStart = performance.now();
	import(`${moduleUrl}?t=${Date.now()}`)
		.then((module) => {
			remount(module);
			sendTiming(clientStart, serverDuration);

			return undefined;
		})
		.catch((err) => {
			console.warn(
				'[HMR] React remount failed, falling back to reload:',
				err
			);
			reloadReactPage();
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

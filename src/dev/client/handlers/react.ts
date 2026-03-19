/* React HMR update handler
   Uses React Fast Refresh to hot-swap components while preserving state.
   Code splitting ensures React lives in a shared chunk that stays cached,
   so dynamic import of the rebuilt entry reuses the same React instance. */

import { hideErrorOverlay } from '../errorOverlay';
import { detectCurrentFramework } from '../frameworkDetect';

export const handleReactUpdate = (message: {
	data: {
		hasCSSChanges?: boolean;
		hasComponentChanges?: boolean;
		manifest?: Record<string, string>;
		pageModuleUrl?: string;
		primarySource?: string;
	};
}) => {
	const currentFramework = detectCurrentFramework();
	if (currentFramework !== 'react') return;

	const hasComponentChanges = message.data.hasComponentChanges !== false;
	const hasCSSChanges = message.data.hasCSSChanges === true;
	const cssPath =
		message.data.manifest && message.data.manifest.ReactExampleCSS;

	// CSS-only change: hot-swap the stylesheet link without reloading
	if (!hasComponentChanges && hasCSSChanges && cssPath) {
		reloadReactCSS(cssPath);

		return;
	}

	const refreshRuntime = window.$RefreshRuntime$;

	// ESM fast path: import the page module directly (no index re-import)
	const pageModuleUrl = message.data.pageModuleUrl;

	if (pageModuleUrl && refreshRuntime) {
		applyRefreshImport(pageModuleUrl, refreshRuntime);

		return;
	}

	// Component change: use React Fast Refresh to preserve state
	const componentKey = window.__REACT_COMPONENT_KEY__;
	const newUrl = componentKey && message.data.manifest?.[componentKey];

	if (newUrl && refreshRuntime) {
		applyRefreshImport(newUrl, refreshRuntime);

		return;
	}

	// Fallback: full page reload
	window.location.reload();
};

const applyRefreshImport = (
	moduleUrl: string,
	refreshRuntime: { performReactRefresh: () => void }
) => {
	import(`${moduleUrl}?t=${Date.now()}`)
		.then(() => {
			refreshRuntime.performReactRefresh();
			if (window.__ERROR_BOUNDARY__) {
				window.__ERROR_BOUNDARY__.reset();
			} else {
				hideErrorOverlay();
			}

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

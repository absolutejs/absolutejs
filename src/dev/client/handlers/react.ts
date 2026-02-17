/* React HMR update handler */

import { saveDOMState, restoreDOMState } from '../domState';
import { findIndexPath, detectCurrentFramework } from '../frameworkDetect';

export function handleReactUpdate(message: {
	data: {
		hasCSSChanges?: boolean;
		hasComponentChanges?: boolean;
		manifest?: Record<string, string>;
		primarySource?: string;
	};
}): void {
	const currentFramework = detectCurrentFramework();
	if (currentFramework !== 'react') return;

	sessionStorage.setItem('__HMR_ACTIVE__', 'true');

	if (!window.__REACT_ROOT__) {
		sessionStorage.removeItem('__HMR_ACTIVE__');
		window.location.reload();
		return;
	}

	const container = document.body;
	if (!container) {
		sessionStorage.removeItem('__HMR_ACTIVE__');
		return;
	}

	const reactDomState = saveDOMState(container);

	const hasComponentChanges = message.data.hasComponentChanges !== false;
	const hasCSSChanges = message.data.hasCSSChanges === true;
	const cssPath =
		message.data.manifest && message.data.manifest.ReactExampleCSS;

	if (!hasComponentChanges && hasCSSChanges && cssPath) {
		reloadReactCSS(cssPath);
		sessionStorage.removeItem('__HMR_ACTIVE__');
		return;
	}

	const indexPath = findIndexPath(
		message.data.manifest,
		message.data.primarySource,
		'react'
	);

	if (!indexPath) {
		sessionStorage.removeItem('__HMR_ACTIVE__');
		window.location.reload();
		return;
	}

	const cacheBustedPath = indexPath + '?t=' + Date.now();
	import(/* @vite-ignore */ cacheBustedPath)
		.then(function () {
			const RefreshRuntime = window.$RefreshRuntime$;
			if (!RefreshRuntime) {
				sessionStorage.removeItem('__HMR_ACTIVE__');
				window.location.reload();
				return;
			}

			const cssPathUpdate =
				message.data.manifest && message.data.manifest.ReactExampleCSS;
			if (hasCSSChanges && cssPathUpdate) {
				reloadReactCSS(cssPathUpdate);
			}

			RefreshRuntime.performReactRefresh();
			restoreDOMState(container, reactDomState);
			sessionStorage.removeItem('__HMR_ACTIVE__');
		})
		.catch(function (error: Error) {
			if (
				error.message.includes('Failed to fetch') ||
				error.message.includes('404')
			) {
				const cssPathUpdate =
					message.data.manifest &&
					message.data.manifest.ReactExampleCSS;
				if (cssPathUpdate) {
					reloadReactCSS(cssPathUpdate);
				}

				sessionStorage.removeItem('__HMR_ACTIVE__');
				window.location.reload();
			} else {
				sessionStorage.removeItem('__HMR_ACTIVE__');
			}
		});
}

function reloadReactCSS(cssPath: string): void {
	const existingCSSLinks = document.head.querySelectorAll(
		'link[rel="stylesheet"]'
	);
	existingCSSLinks.forEach(function (link) {
		const href = (link as HTMLLinkElement).getAttribute('href');
		if (href) {
			const hrefBase = href.split('?')[0]!.split('/').pop() || '';
			const cssPathBase = cssPath.split('?')[0]!.split('/').pop() || '';
			if (
				hrefBase === cssPathBase ||
				href.includes('react-example') ||
				cssPathBase.includes(hrefBase)
			) {
				const newHref =
					cssPath +
					(cssPath.includes('?') ? '&' : '?') +
					't=' +
					Date.now();
				(link as HTMLLinkElement).href = newHref;
			}
		}
	});
}

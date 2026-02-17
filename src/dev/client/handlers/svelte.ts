/* Svelte HMR update handler */

import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';

export const handleSvelteUpdate = (message: {
	data: {
		clientModuleUrl?: string;
		cssBaseName?: string;
		cssUrl?: string;
		manifest?: Record<string, string>;
		sourceFile?: string;
		updateType?: string;
	};
}) => {
	const svelteFrameworkCheck = detectCurrentFramework();
	if (svelteFrameworkCheck !== 'svelte') return;

	if (message.data.updateType === 'css-only' && message.data.cssUrl) {
		console.log('[HMR] Svelte CSS-only update (state preserved)');
		const cssBaseName = message.data.cssBaseName || '';
		let existingLink: HTMLLinkElement | null = null;
		document
			.querySelectorAll('link[rel="stylesheet"]')
			.forEach(function (link) {
				const href =
					(link as HTMLLinkElement).getAttribute('href') || '';
				if (href.includes(cssBaseName) || href.includes('svelte')) {
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
				console.log('[HMR] Svelte CSS updated');
			};
			document.head.appendChild(newLink);
		}
		return;
	}

	if (window.__REACT_ROOT__) {
		window.__REACT_ROOT__ = undefined;
	}

	sessionStorage.setItem('__HMR_ACTIVE__', 'true');

	if (message.data.clientModuleUrl) {
		window.__SVELTE_PROPS__ =
			window.__SVELTE_PROPS__ || window.__INITIAL_PROPS__ || {};

		const clientModuleUrl =
			message.data.clientModuleUrl + '?t=' + Date.now();
		console.log('[HMR] Svelte official HMR: importing', clientModuleUrl);

		import(/* @vite-ignore */ clientModuleUrl)
			.then(function () {
				sessionStorage.removeItem('__HMR_ACTIVE__');
				console.log(
					'[HMR] Svelte component updated via official HMR (state preserved)'
				);
			})
			.catch(function (err: unknown) {
				console.warn(
					'[HMR] Svelte official HMR failed, trying fallback:',
					err
				);
				performSvelteFallback(message);
			});
		return;
	}

	performSvelteFallback(message);
};

const performSvelteFallback = (message: {
	data: {
		manifest?: Record<string, string>;
		sourceFile?: string;
	};
}) => {
	try {
		const preservedState: Record<string, unknown> = {};
		const button = document.querySelector('button');
		if (button) {
			const countMatch =
				button.textContent &&
				button.textContent.match(/count is (\d+)/);
			if (countMatch) {
				preservedState.initialCount = parseInt(countMatch[1]!, 10);
			}
		}

		window.__SVELTE_HMR_UPDATE__ = true;
		window.__HMR_PRESERVED_STATE__ = preservedState;

		const indexPath = findIndexPath(
			message.data.manifest,
			message.data.sourceFile,
			'svelte'
		);
		if (!indexPath) {
			window.location.reload();
			return;
		}

		const modulePath = indexPath + '?hmr=' + Date.now();
		import(/* @vite-ignore */ modulePath)
			.then(function () {
				sessionStorage.removeItem('__HMR_ACTIVE__');
				console.log('[HMR] Svelte component updated via fallback');
			})
			.catch(function () {
				sessionStorage.removeItem('__HMR_ACTIVE__');
				window.location.reload();
			});
	} catch {
		sessionStorage.removeItem('__HMR_ACTIVE__');
		window.location.reload();
	}
};

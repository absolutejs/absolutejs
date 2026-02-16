/* Vue HMR update handler */

import { saveDOMState, restoreDOMState } from '../domState';
import { detectCurrentFramework, findIndexPath } from '../frameworkDetect';

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

	sessionStorage.setItem('__HMR_ACTIVE__', 'true');

	const vueRoot = document.getElementById('root');
	const vueDomState = vueRoot ? saveDOMState(vueRoot) : null;

	const vuePreservedState: Record<string, unknown> = {};
	const countButton = document.querySelector('button');
	if (countButton && countButton.textContent) {
		const countMatch = countButton.textContent.match(/count is (\d+)/i);
		if (countMatch) {
			vuePreservedState.initialCount = parseInt(countMatch[1]!, 10);
		}
	}

	window.__HMR_PRESERVED_STATE__ = vuePreservedState;

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

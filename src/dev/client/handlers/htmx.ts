/* HTMX HMR update handler */

import { patchDOMInPlace } from '../domDiff';
import {
	saveDOMState,
	restoreDOMState,
	saveFormState,
	restoreFormState,
	saveScrollState,
	restoreScrollState
} from '../domState';
import { processCSSLinks, waitForCSSAndUpdate } from '../cssUtils';
import { patchHeadInPlace } from '../headPatch';
import { detectCurrentFramework } from '../frameworkDetect';
import type { ScriptInfo } from '../types';
import { hmrState } from '../types';

export function handleHTMXUpdate(message: {
	data: {
		html?: string | { body?: string; head?: string } | null;
	};
}): void {
	const htmxFrameworkCheck = detectCurrentFramework();
	if (htmxFrameworkCheck !== 'htmx') return;

	if (window.__REACT_ROOT__) {
		window.__REACT_ROOT__ = undefined;
	}

	sessionStorage.setItem('__HMR_ACTIVE__', 'true');

	const htmxDomState = saveDOMState(document.body);

	let htmxBody: string | null = null;
	let htmxHead: string | null = null;
	if (typeof message.data.html === 'string') {
		htmxBody = message.data.html;
	} else if (message.data.html && typeof message.data.html === 'object') {
		htmxBody = message.data.html.body || null;
		htmxHead = message.data.html.head || null;
	}

	if (htmxBody) {
		const capturedBody = htmxBody;

		const updateHTMXBodyAfterCSS = function () {
			updateHTMXBody(capturedBody, htmxDomState, document.body);
		};

		if (htmxHead) {
			console.log('[HMR] Has htmxHead, patching head elements');

			const doPatchHead = function () {
				patchHeadInPlace(htmxHead!);
			};
			if (hmrState.isFirstHMRUpdate) {
				console.log(
					'[HMR] First update - adding head patch stabilization delay'
				);
				setTimeout(doPatchHead, 50);
			} else {
				doPatchHead();
			}

			console.log('[HMR] Processing CSS links');
			const cssResult = processCSSLinks(htmxHead);

			waitForCSSAndUpdate(cssResult, updateHTMXBodyAfterCSS);
		} else {
			updateHTMXBodyAfterCSS();
		}
	} else {
		sessionStorage.removeItem('__HMR_ACTIVE__');
	}
}

function updateHTMXBody(
	htmxBody: string,
	htmxDomState: ReturnType<typeof saveDOMState>,
	container: HTMLElement
): void {
	if (!container) return;

	const countSpan = container.querySelector('#count');
	const countValue = countSpan
		? parseInt(countSpan.textContent || '0', 10)
		: 0;

	const savedState = {
		componentState: { count: countValue },
		forms: saveFormState(),
		scroll: saveScrollState()
	};

	const existingScripts = collectScripts(container);

	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = htmxBody;

	if (savedState.componentState.count !== undefined) {
		const newCounterSpan = tempDiv.querySelector('#count');
		if (newCounterSpan) {
			newCounterSpan.textContent = String(
				savedState.componentState.count
			);
		}
	}

	const patchedBody = tempDiv.innerHTML;
	const newScripts = collectScriptsFromElement(tempDiv);
	const scriptsChanged = didScriptsChange(existingScripts, newScripts);

	const htmlStructureChanged = didHTMLStructureChange(container, tempDiv);

	const hmrScript = container.querySelector('script[data-hmr-client]');

	patchDOMInPlace(container, patchedBody);

	if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
		container.appendChild(hmrScript);
	}

	requestAnimationFrame(function () {
		restoreFormState(savedState.forms);
		restoreScrollState(savedState.scroll);

		const newCountSpan = container.querySelector('#count');
		if (newCountSpan && savedState.componentState.count !== undefined) {
			newCountSpan.textContent = String(savedState.componentState.count);
		}

		restoreDOMState(container, htmxDomState);

		if (scriptsChanged || htmlStructureChanged) {
			container
				.querySelectorAll('[data-hmr-listeners-attached]')
				.forEach(function (el) {
					const cloned = el.cloneNode(true) as Element;
					if (el.parentNode) {
						el.parentNode.replaceChild(cloned, el);
					}
					cloned.removeAttribute('data-hmr-listeners-attached');
				});

			const scriptsInNewHTML = container.querySelectorAll('script[src]');
			scriptsInNewHTML.forEach(function (script) {
				if (!(script as Element).hasAttribute('data-hmr-client')) {
					script.remove();
				}
			});

			newScripts.forEach(function (scriptInfo) {
				const newScript = document.createElement('script');
				const separator = scriptInfo.src.includes('?') ? '&' : '?';
				newScript.src = scriptInfo.src + separator + 't=' + Date.now();
				newScript.type = scriptInfo.type;
				container.appendChild(newScript);
			});

			const inlineScripts =
				container.querySelectorAll('script:not([src])');
			inlineScripts.forEach(function (script) {
				if (!(script as Element).hasAttribute('data-hmr-client')) {
					const newScript = document.createElement('script');
					newScript.textContent = script.textContent || '';
					newScript.type =
						(script as HTMLScriptElement).type || 'text/javascript';
					if (script.parentNode) {
						script.parentNode.replaceChild(newScript, script);
					}
				}
			});
		}

		if (window.htmx) {
			window.htmx.process(container);
		}
	});
	sessionStorage.removeItem('__HMR_ACTIVE__');
}

/* Shared helpers */

function collectScripts(container: HTMLElement): ScriptInfo[] {
	return Array.from(container.querySelectorAll('script[src]')).map(
		function (script) {
			return {
				src: script.getAttribute('src') || '',
				type: script.getAttribute('type') || 'text/javascript'
			};
		}
	);
}

function collectScriptsFromElement(el: HTMLElement): ScriptInfo[] {
	return Array.from(el.querySelectorAll('script[src]')).map(
		function (script) {
			return {
				src: script.getAttribute('src') || '',
				type: script.getAttribute('type') || 'text/javascript'
			};
		}
	);
}

function didScriptsChange(
	oldScripts: ScriptInfo[],
	newScripts: ScriptInfo[]
): boolean {
	return (
		oldScripts.length !== newScripts.length ||
		oldScripts.some(function (oldScript, idx) {
			const oldSrcBase = oldScript.src.split('?')[0]!.split('&')[0];
			const newScript = newScripts[idx];
			if (!newScript) return true;
			const newSrcBase = newScript.src.split('?')[0]!.split('&')[0];
			return oldSrcBase !== newSrcBase;
		})
	);
}

function normalizeHTMLForComparison(element: HTMLElement): string {
	const clone = element.cloneNode(true) as HTMLElement;
	const scripts = clone.querySelectorAll('script');
	scripts.forEach(function (script) {
		if (script.parentNode) {
			script.parentNode.removeChild(script);
		}
	});
	const allElements = clone.querySelectorAll('*');
	allElements.forEach(function (el) {
		el.removeAttribute('data-hmr-listeners-attached');
	});
	if (clone.removeAttribute) {
		clone.removeAttribute('data-hmr-listeners-attached');
	}
	return clone.innerHTML;
}

function didHTMLStructureChange(
	container: HTMLElement,
	tempDiv: HTMLElement
): boolean {
	return (
		normalizeHTMLForComparison(container) !==
		normalizeHTMLForComparison(tempDiv)
	);
}

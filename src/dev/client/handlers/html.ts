/* HTML + script HMR update handlers */

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
import type { ScriptInfo } from '../../../../types/client';
import { hmrState } from '../../../../types/client';

export const handleScriptUpdate = (message: {
	data: { framework?: string; scriptPath?: string };
}) => {
	console.log('[HMR] Received script-update message');
	const scriptFramework = message.data.framework;
	const currentFw = detectCurrentFramework();

	if (currentFw !== scriptFramework) {
		console.log(
			'[HMR] Skipping script update - different framework:',
			currentFw,
			'vs',
			scriptFramework
		);
		return;
	}

	const scriptPath = message.data.scriptPath;
	if (!scriptPath) {
		console.warn('[HMR] No script path in update');
		return;
	}

	console.log('[HMR] Hot-reloading script:', scriptPath);

	const interactiveSelectors =
		'button, [onclick], [onchange], [oninput], details, input, select, textarea';
	document.body.querySelectorAll(interactiveSelectors).forEach(function (el) {
		const cloned = el.cloneNode(true);
		if (el.parentNode) {
			el.parentNode.replaceChild(cloned, el);
		}
	});

	const counterSpan = document.querySelector('#counter');
	if (counterSpan) {
		window.__HMR_DOM_STATE__ = {
			count: parseInt(counterSpan.textContent || '0', 10)
		};
	}

	const cacheBustedPath = scriptPath + '?t=' + Date.now();
	import(/* @vite-ignore */ cacheBustedPath)
		.then(function () {
			console.log('[HMR] Script hot-reloaded successfully');
		})
		.catch(function (err: unknown) {
			console.error(
				'[HMR] Script hot-reload failed, falling back to page reload:',
				err
			);
			window.location.reload();
		});
};

export const handleHTMLUpdate = (message: {
	data: {
		html?: string | { body?: string; head?: string } | null;
	};
}) => {
	console.log('[HMR] Received html-update message');
	const htmlFrameworkCheck = detectCurrentFramework();
	console.log('[HMR] Current framework:', htmlFrameworkCheck);
	if (htmlFrameworkCheck !== 'html') {
		console.log('[HMR] Skipping - not on HTML page');
		return;
	}

	if (window.__REACT_ROOT__) {
		window.__REACT_ROOT__ = undefined;
	}

	sessionStorage.setItem('__HMR_ACTIVE__', 'true');

	const htmlDomState = saveDOMState(document.body);

	let htmlBody: string | null = null;
	let htmlHead: string | null = null;
	if (typeof message.data.html === 'string') {
		htmlBody = message.data.html;
	} else if (message.data.html && typeof message.data.html === 'object') {
		htmlBody = message.data.html.body || null;
		htmlHead = message.data.html.head || null;
	}
	console.log('[HMR] htmlBody length:', htmlBody ? htmlBody.length : 'null');
	console.log('[HMR] htmlHead:', htmlHead ? 'present' : 'null');

	if (htmlBody) {
		console.log('[HMR] Processing htmlBody');
		if (htmlHead) {
			console.log('[HMR] Has htmlHead, patching head elements');

			const doPatchHead = function () {
				patchHeadInPlace(htmlHead!);
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
			const cssResult = processCSSLinks(htmlHead);

			const updateBodyAfterCSS = function () {
				updateHTMLBody(htmlBody!, htmlDomState, document.body);
			};

			console.log(
				'[HMR] linksToWaitFor count:',
				cssResult.linksToWaitFor.length
			);
			waitForCSSAndUpdate(cssResult, updateBodyAfterCSS);
		} else {
			console.log('[HMR] No htmlHead, patching body directly');
			const container = document.body;
			if (container) {
				updateHTMLBodyDirect(htmlBody, htmlDomState, container);
				restoreDOMState(container, htmlDomState);
			} else {
				sessionStorage.removeItem('__HMR_ACTIVE__');
			}
		}
	} else {
		sessionStorage.removeItem('__HMR_ACTIVE__');
	}
};

const updateHTMLBody = (
	htmlBody: string,
	htmlDomState: ReturnType<typeof saveDOMState>,
	container: HTMLElement
) => {
	console.log('[HMR] updateBodyAfterCSS called');
	if (!container) {
		console.log('[HMR] ERROR: document.body not found');
		return;
	}

	const counterSpan = container.querySelector('#counter');
	const counterValue = counterSpan
		? parseInt(counterSpan.textContent || '0', 10)
		: 0;

	const savedState = {
		componentState: { count: counterValue },
		forms: saveFormState(),
		scroll: saveScrollState()
	};

	let body = htmlBody;
	if (counterValue > 0) {
		body = body.replace(
			new RegExp('<span id="counter">0<' + '/span>', 'g'),
			'<span id="counter">' + counterValue + '<' + '/span>'
		);
	}

	const existingScripts = collectScripts(container);
	const hmrScript = container.querySelector('script[data-hmr-client]');
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = body;
	const newScripts = collectScriptsFromElement(tempDiv);

	const scriptsChanged = didScriptsChange(existingScripts, newScripts);
	const htmlStructureChanged = didHTMLStructureChange(container, tempDiv);

	if (!htmlStructureChanged && !scriptsChanged) {
		console.log('[HMR] CSS-only change detected - skipping body patch');
	} else {
		patchDOMInPlace(container, body);
	}

	if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
		container.appendChild(hmrScript);
	}

	requestAnimationFrame(function () {
		restoreFormState(savedState.forms);
		restoreScrollState(savedState.scroll);

		const newCounterSpan = container.querySelector('#counter');
		if (newCounterSpan && savedState.componentState.count !== undefined) {
			newCounterSpan.textContent = String(
				savedState.componentState.count
			);
		}

		if (scriptsChanged || htmlStructureChanged) {
			cloneInteractiveElements(container);
			window.__HMR_DOM_STATE__ = {
				count: savedState.componentState.count || 0
			};
			reExecuteScripts(container, newScripts);
		}
	});
	sessionStorage.removeItem('__HMR_ACTIVE__');
};

const updateHTMLBodyDirect = (
	htmlBody: string,
	htmlDomState: ReturnType<typeof saveDOMState>,
	container: HTMLElement
) => {
	const counterSpan = container.querySelector('#counter');
	const counterValue = counterSpan
		? parseInt(counterSpan.textContent || '0', 10)
		: 0;

	const savedState = {
		componentState: { count: counterValue },
		forms: saveFormState(),
		scroll: saveScrollState()
	};

	let body = htmlBody;
	if (counterValue > 0) {
		body = body.replace(
			new RegExp('<span id="counter">0<' + '/span>', 'g'),
			'<span id="counter">' + counterValue + '<' + '/span>'
		);
	}

	const existingScripts = collectScripts(container);
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = body;
	const newScripts = collectScriptsFromElement(tempDiv);
	const scriptsChanged = didScriptsChange(existingScripts, newScripts);
	const hmrScript = container.querySelector('script[data-hmr-client]');

	patchDOMInPlace(container, body);

	if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
		container.appendChild(hmrScript);
	}

	requestAnimationFrame(function () {
		restoreFormState(savedState.forms);
		restoreScrollState(savedState.scroll);

		const newCounterSpan = container.querySelector('#counter');
		if (newCounterSpan && savedState.componentState.count !== undefined) {
			newCounterSpan.textContent = String(
				savedState.componentState.count
			);
		}

		container
			.querySelectorAll('[data-hmr-listeners-attached]')
			.forEach(function (el) {
				const cloned = el.cloneNode(true) as Element;
				if (el.parentNode) {
					el.parentNode.replaceChild(cloned, el);
				}
				cloned.removeAttribute('data-hmr-listeners-attached');
			});

		removeOldScripts(container);
		newScripts.forEach(function (scriptInfo) {
			const newScript = document.createElement('script');
			const separator = scriptInfo.src.includes('?') ? '&' : '?';
			newScript.src = scriptInfo.src + separator + 't=' + Date.now();
			newScript.type = scriptInfo.type;
			container.appendChild(newScript);
		});

		const inlineScripts = container.querySelectorAll('script:not([src])');
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
	});
	sessionStorage.removeItem('__HMR_ACTIVE__');
};

/* Shared helpers for HTML body updates */

const collectScripts = (container: HTMLElement) => {
	return Array.from(container.querySelectorAll('script[src]')).map(
		function (script) {
			return {
				src: script.getAttribute('src') || '',
				type: script.getAttribute('type') || 'text/javascript'
			};
		}
	);
};

const collectScriptsFromElement = (el: HTMLElement) => {
	return Array.from(el.querySelectorAll('script[src]')).map(
		function (script) {
			return {
				src: script.getAttribute('src') || '',
				type: script.getAttribute('type') || 'text/javascript'
			};
		}
	);
};

const didScriptsChange = (
	oldScripts: ScriptInfo[],
	newScripts: ScriptInfo[]
) => {
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
};

const normalizeHTMLForComparison = (element: HTMLElement) => {
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
};

const didHTMLStructureChange = (
	container: HTMLElement,
	tempDiv: HTMLElement
) => {
	return (
		normalizeHTMLForComparison(container) !==
		normalizeHTMLForComparison(tempDiv)
	);
};

const cloneInteractiveElements = (container: HTMLElement) => {
	const interactiveSelectors =
		'button, [onclick], [onchange], [oninput], [onsubmit], ' +
		'details, input[type="button"], input[type="submit"], input[type="reset"]';
	container.querySelectorAll(interactiveSelectors).forEach(function (el) {
		const cloned = el.cloneNode(true);
		if (el.parentNode) {
			el.parentNode.replaceChild(cloned, el);
		}
	});
};

const removeOldScripts = (container: HTMLElement) => {
	const scriptsInNewHTML = container.querySelectorAll('script[src]');
	scriptsInNewHTML.forEach(function (script) {
		if (!(script as Element).hasAttribute('data-hmr-client')) {
			script.remove();
		}
	});
};

const reExecuteScripts = (container: HTMLElement, newScripts: ScriptInfo[]) => {
	removeOldScripts(container);

	newScripts.forEach(function (scriptInfo) {
		const newScript = document.createElement('script');
		const separator = scriptInfo.src.includes('?') ? '&' : '?';
		newScript.src = scriptInfo.src + separator + 't=' + Date.now();
		newScript.type = scriptInfo.type;
		container.appendChild(newScript);
	});

	const inlineScripts = container.querySelectorAll('script:not([src])');
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
};

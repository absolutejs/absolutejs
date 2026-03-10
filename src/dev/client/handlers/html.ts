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

const parseHTMLMessage = (
	html: string | { body?: string; head?: string } | null | undefined
) => {
	let body: string | null = null;
	let head: string | null = null;
	if (typeof html === 'string') {
		body = html;
	} else if (html && typeof html === 'object') {
		body = html.body || null;
		head = html.head || null;
	}

	return { body, head };
};

const applyHeadPatch = (htmlHead: string | null) => {
	if (!htmlHead) {
		return;
	}

	const doPatchHead = () => {
		patchHeadInPlace(htmlHead);
	};
	if (hmrState.isFirstHMRUpdate) {
		setTimeout(doPatchHead, 50);
	} else {
		doPatchHead();
	}
};

const handleHTMLBodyWithHead = (
	htmlBody: string,
	htmlHead: string,
	htmlDomState: ReturnType<typeof saveDOMState>
) => {
	applyHeadPatch(htmlHead);

	const cssResult = processCSSLinks(htmlHead);

	const updateBodyAfterCSS = () => {
		updateHTMLBody(htmlBody, htmlDomState, document.body);
	};

	waitForCSSAndUpdate(cssResult, updateBodyAfterCSS);
};

const handleHTMLBodyWithoutHead = (
	htmlBody: string,
	htmlDomState: ReturnType<typeof saveDOMState>
) => {
	const container = document.body;
	if (!container) {
		sessionStorage.removeItem('__HMR_ACTIVE__');

		return;
	}

	updateHTMLBodyDirect(htmlBody, htmlDomState, container);
	restoreDOMState(container, htmlDomState);
};

export const handleHTMLUpdate = (message: {
	data: {
		html?: string | { body?: string; head?: string } | null;
	};
}) => {
	const htmlFrameworkCheck = detectCurrentFramework();
	if (htmlFrameworkCheck !== 'html') {
		return;
	}

	if (window.__REACT_ROOT__) {
		window.__REACT_ROOT__ = undefined;
	}

	sessionStorage.setItem('__HMR_ACTIVE__', 'true');

	const htmlDomState = saveDOMState(document.body);
	const { body: htmlBody, head: htmlHead } = parseHTMLMessage(
		message.data.html
	);

	if (!htmlBody) {
		sessionStorage.removeItem('__HMR_ACTIVE__');

		return;
	}

	if (htmlHead) {
		handleHTMLBodyWithHead(htmlBody, htmlHead, htmlDomState);
	} else {
		handleHTMLBodyWithoutHead(htmlBody, htmlDomState);
	}
};
export const handleScriptUpdate = (message: {
	data: { framework?: string; scriptPath?: string };
}) => {
	const scriptFramework = message.data.framework;
	const currentFw = detectCurrentFramework();

	if (currentFw !== scriptFramework) {
		return;
	}

	const { scriptPath } = message.data;
	if (!scriptPath) {
		console.warn('[HMR] No script path in update');

		return;
	}

	const interactiveSelectors =
		'button, [onclick], [onchange], [oninput], details, input, select, textarea';
	document.body.querySelectorAll(interactiveSelectors).forEach((el) => {
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

	const cacheBustedPath = `${scriptPath}?t=${Date.now()}`;
	import(/* @vite-ignore */ cacheBustedPath)
		.then(() => {
			/* script reloaded */
		})
		.catch((err: unknown) => {
			console.error(
				'[HMR] Script hot-reload failed, falling back to page reload:',
				err
			);
			window.location.reload();
		});
};

const saveHTMLState = (container: HTMLElement) => {
	const counterSpan = container.querySelector('#counter');
	const counterValue = counterSpan
		? parseInt(counterSpan.textContent || '0', 10)
		: 0;

	return {
		componentState: { count: counterValue },
		forms: saveFormState(),
		scroll: saveScrollState()
	};
};

const applyCounterToBody = (body: string, counterValue: number) => {
	if (counterValue <= 0) {
		return body;
	}

	return body.replace(
		new RegExp('<span id="counter">0<' + '/span>', 'g'),
		`<span id="counter">${counterValue}<` + `/span>`
	);
};

const restoreCounterSpan = (
	container: HTMLElement,
	count: number | undefined
) => {
	const newCounterSpan = container.querySelector('#counter');
	if (newCounterSpan && count !== undefined) {
		newCounterSpan.textContent = String(count);
	}
};

const preserveHmrScript = (
	container: HTMLElement,
	hmrScript: Element | null
) => {
	if (hmrScript && !container.querySelector('script[data-hmr-client]')) {
		container.appendChild(hmrScript);
	}
};

const updateHTMLBody = (
	htmlBody: string,
	htmlDomState: ReturnType<typeof saveDOMState>,
	container: HTMLElement
) => {
	if (!container) {
		return;
	}

	const savedState = saveHTMLState(container);
	const body = applyCounterToBody(htmlBody, savedState.componentState.count);

	const existingScripts = collectScripts(container);
	const hmrScript = container.querySelector('script[data-hmr-client]');
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = body;
	const newScripts = collectScriptsFromElement(tempDiv);

	const scriptsChanged = didScriptsChange(existingScripts, newScripts);
	const htmlStructureChanged = didHTMLStructureChange(container, tempDiv);

	if (htmlStructureChanged || scriptsChanged) {
		patchDOMInPlace(container, body);
	}

	preserveHmrScript(container, hmrScript);

	requestAnimationFrame(() => {
		restoreFormState(savedState.forms);
		restoreScrollState(savedState.scroll);
		restoreCounterSpan(container, savedState.componentState.count);

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

const cloneHmrListenerElements = (container: HTMLElement) => {
	container
		.querySelectorAll('[data-hmr-listeners-attached]')
		.forEach((el) => {
			const cloned = el.cloneNode(true) as Element;
			if (el.parentNode) {
				el.parentNode.replaceChild(cloned, el);
			}
			cloned.removeAttribute('data-hmr-listeners-attached');
		});
};

const replaceInlineScript = (script: Element) => {
	if (script.hasAttribute('data-hmr-client')) {
		return;
	}

	const newScript = document.createElement('script');
	newScript.textContent = script.textContent || '';
	newScript.type = (script as HTMLScriptElement).type || 'text/javascript';
	if (script.parentNode) {
		script.parentNode.replaceChild(newScript, script);
	}
};

const updateHTMLBodyDirect = (
	htmlBody: string,
	htmlDomState: ReturnType<typeof saveDOMState>,
	container: HTMLElement
) => {
	const savedState = saveHTMLState(container);
	const body = applyCounterToBody(htmlBody, savedState.componentState.count);

	const existingScripts = collectScripts(container);
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = body;
	const newScripts = collectScriptsFromElement(tempDiv);
	const scriptsChanged = didScriptsChange(existingScripts, newScripts);
	const hmrScript = container.querySelector('script[data-hmr-client]');

	patchDOMInPlace(container, body);

	preserveHmrScript(container, hmrScript);

	requestAnimationFrame(() => {
		restoreFormState(savedState.forms);
		restoreScrollState(savedState.scroll);
		restoreCounterSpan(container, savedState.componentState.count);

		cloneHmrListenerElements(container);

		removeOldScripts(container);
		newScripts.forEach((scriptInfo) => {
			const newScript = document.createElement('script');
			const separator = scriptInfo.src.includes('?') ? '&' : '?';
			newScript.src = `${scriptInfo.src + separator}t=${Date.now()}`;
			newScript.type = scriptInfo.type;
			container.appendChild(newScript);
		});

		const inlineScripts = container.querySelectorAll('script:not([src])');
		inlineScripts.forEach(replaceInlineScript);
	});
	sessionStorage.removeItem('__HMR_ACTIVE__');
};

/* Shared helpers for HTML body updates */

const collectScripts = (container: HTMLElement) =>
	Array.from(container.querySelectorAll('script[src]')).map((script) => ({
		src: script.getAttribute('src') || '',
		type: script.getAttribute('type') || 'text/javascript'
	}));

const collectScriptsFromElement = (el: HTMLElement) =>
	Array.from(el.querySelectorAll('script[src]')).map((script) => ({
		src: script.getAttribute('src') || '',
		type: script.getAttribute('type') || 'text/javascript'
	}));

const didScriptsChange = (oldScripts: ScriptInfo[], newScripts: ScriptInfo[]) =>
	oldScripts.length !== newScripts.length ||
	oldScripts.some((oldScript, idx) => {
		const oldSrcBase = oldScript.src.split('?')[0]!.split('&')[0];
		const newScript = newScripts[idx];
		if (!newScript) return true;
		const newSrcBase = newScript.src.split('?')[0]!.split('&')[0];

		return oldSrcBase !== newSrcBase;
	});

const normalizeHTMLForComparison = (element: HTMLElement) => {
	const clone = element.cloneNode(true) as HTMLElement;
	const scripts = clone.querySelectorAll('script');
	scripts.forEach((script) => {
		if (script.parentNode) {
			script.parentNode.removeChild(script);
		}
	});
	const allElements = clone.querySelectorAll('*');
	allElements.forEach((el) => {
		el.removeAttribute('data-hmr-listeners-attached');
	});
	if (clone.removeAttribute) {
		clone.removeAttribute('data-hmr-listeners-attached');
	}

	return clone.innerHTML;
};

const didHTMLStructureChange = (container: HTMLElement, tempDiv: HTMLElement) =>
	normalizeHTMLForComparison(container) !==
	normalizeHTMLForComparison(tempDiv);

const cloneInteractiveElements = (container: HTMLElement) => {
	const interactiveSelectors =
		'button, [onclick], [onchange], [oninput], [onsubmit], ' +
		'details, input[type="button"], input[type="submit"], input[type="reset"]';
	container.querySelectorAll(interactiveSelectors).forEach((el) => {
		const cloned = el.cloneNode(true);
		if (el.parentNode) {
			el.parentNode.replaceChild(cloned, el);
		}
	});
};

const removeOldScripts = (container: HTMLElement) => {
	const scriptsInNewHTML = container.querySelectorAll('script[src]');
	scriptsInNewHTML.forEach((script) => {
		if (!script.hasAttribute('data-hmr-client')) {
			script.remove();
		}
	});
};

const reExecuteScripts = (container: HTMLElement, newScripts: ScriptInfo[]) => {
	removeOldScripts(container);

	newScripts.forEach((scriptInfo) => {
		const newScript = document.createElement('script');
		const separator = scriptInfo.src.includes('?') ? '&' : '?';
		newScript.src = `${scriptInfo.src + separator}t=${Date.now()}`;
		newScript.type = scriptInfo.type;
		container.appendChild(newScript);
	});

	const inlineScripts = container.querySelectorAll('script:not([src])');
	inlineScripts.forEach(replaceInlineScript);
};

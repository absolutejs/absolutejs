/* HTML + script HMR update handlers */

import { DOM_UPDATE_DELAY_MS } from '../../../constants';
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
import { type ScriptInfo, hmrState } from '../.././../../types/client';
import { restoreDOMChanges, snapshotDOMChanges } from '../domTracker';

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
		setTimeout(doPatchHead, DOM_UPDATE_DELAY_MS);
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
	document.body.querySelectorAll(interactiveSelectors).forEach((elem) => {
		const cloned = elem.cloneNode(true);
		if (elem.parentNode) {
			elem.parentNode.replaceChild(cloned, elem);
		}
	});

	const cacheBustedPath = `${scriptPath}?t=${Date.now()}`;
	import(cacheBustedPath)
		.then(() => true)
		.catch((err: unknown) => {
			console.error(
				'[HMR] Script hot-reload failed, falling back to page reload:',
				err
			);
			window.location.reload();
		});
};

// eslint-disable-next-line absolute/no-useless-function -- must be called each time to capture current state
const saveHTMLState = () => ({
	forms: saveFormState(),
	scroll: saveScrollState()
});

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

	const savedState = saveHTMLState();
	const domSnapshot = snapshotDOMChanges(container);

	const existingScripts = collectScripts(container);
	const hmrScript = container.querySelector('script[data-hmr-client]');
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = htmlBody;
	const newScripts = collectScriptsFromElement(tempDiv);

	const htmlStructureChanged = didHTMLStructureChange(container, tempDiv);

	if (htmlStructureChanged || didScriptsChange(existingScripts, newScripts)) {
		patchDOMInPlace(container, htmlBody);
		restoreDOMChanges(container, domSnapshot, htmlBody);
	}

	preserveHmrScript(container, hmrScript);

	requestAnimationFrame(() => {
		restoreDOMState(container, htmlDomState);
		restoreFormState(savedState.forms);
		restoreScrollState(savedState.scroll);

		if (
			didScriptsChange(existingScripts, newScripts) ||
			htmlStructureChanged
		) {
			cloneInteractiveElements(container);
			reExecuteScripts(container, newScripts);
		}
	});
	sessionStorage.removeItem('__HMR_ACTIVE__');
};

const cloneHmrListenerElements = (container: HTMLElement) => {
	container
		.querySelectorAll('[data-hmr-listeners-attached]')
		.forEach((elem) => {
			const cloned = elem.cloneNode(true);
			if (elem.parentNode) {
				elem.parentNode.replaceChild(cloned, elem);
			}
			if (cloned instanceof Element) {
				cloned.removeAttribute('data-hmr-listeners-attached');
			}
		});
};

const replaceInlineScript = (script: Element) => {
	if (script.hasAttribute('data-hmr-client')) {
		return;
	}

	const newScript = document.createElement('script');
	newScript.textContent = script.textContent || '';
	const scriptEl = script instanceof HTMLScriptElement ? script : null;
	newScript.type = scriptEl?.type || 'text/javascript';
	if (script.parentNode) {
		script.parentNode.replaceChild(newScript, script);
	}
};

const updateHTMLBodyDirect = (
	htmlBody: string,
	htmlDomState: ReturnType<typeof saveDOMState>,
	container: HTMLElement
) => {
	const savedState = saveHTMLState();
	const domSnapshot = snapshotDOMChanges(container);

	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = htmlBody;
	const newScripts = collectScriptsFromElement(tempDiv);
	const hmrScript = container.querySelector('script[data-hmr-client]');

	patchDOMInPlace(container, htmlBody);
	restoreDOMChanges(container, domSnapshot, htmlBody);

	preserveHmrScript(container, hmrScript);

	requestAnimationFrame(() => {
		restoreDOMState(container, htmlDomState);
		restoreFormState(savedState.forms);
		restoreScrollState(savedState.scroll);

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

const collectScriptsFromElement = (elem: HTMLElement) =>
	Array.from(elem.querySelectorAll('script[src]')).map((script) => ({
		src: script.getAttribute('src') || '',
		type: script.getAttribute('type') || 'text/javascript'
	}));

const didScriptsChange = (oldScripts: ScriptInfo[], newScripts: ScriptInfo[]) =>
	oldScripts.length !== newScripts.length ||
	oldScripts.some((oldScript, idx) => {
		const [oldSrcBase] = oldScript.src.split('?')[0]?.split('&') ?? [''];
		const newScript = newScripts[idx];
		if (!newScript) return true;
		const [newSrcBase] = newScript.src.split('?')[0]?.split('&') ?? [''];

		return oldSrcBase !== newSrcBase;
	});

const normalizeHTMLForComparison = (element: HTMLElement) => {
	const clonedNode = element.cloneNode(true);
	if (!(clonedNode instanceof HTMLElement)) return '';
	const clone = clonedNode;
	const scripts = clone.querySelectorAll('script');
	scripts.forEach((script) => {
		if (script.parentNode) {
			script.parentNode.removeChild(script);
		}
	});
	const allElements = clone.querySelectorAll('*');
	allElements.forEach((elem) => {
		elem.removeAttribute('data-hmr-listeners-attached');
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
	container.querySelectorAll(interactiveSelectors).forEach((elem) => {
		const cloned = elem.cloneNode(true);
		if (elem.parentNode) {
			elem.parentNode.replaceChild(cloned, elem);
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

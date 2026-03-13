/* HTMX HMR update handler */

import { DOM_UPDATE_DELAY_MS } from '../constants';
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
import {
	type HTMXSavedState,
	type ScriptInfo,
	hmrState
} from '../../../../types/client';

const parseHTMXMessage = (
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

const applyHeadPatch = (htmxHead: string | null) => {
	if (!htmxHead) {
		return;
	}

	const doPatchHead = () => {
		patchHeadInPlace(htmxHead);
	};
	if (hmrState.isFirstHMRUpdate) {
		setTimeout(doPatchHead, DOM_UPDATE_DELAY_MS);
	} else {
		doPatchHead();
	}
};

const handleHTMXBodyUpdate = (
	htmxBody: string,
	htmxHead: string | null,
	htmxDomState: ReturnType<typeof saveDOMState>
) => {
	const updateHTMXBodyAfterCSS = () => {
		updateHTMXBody(htmxBody, htmxDomState, document.body);
	};

	if (htmxHead) {
		applyHeadPatch(htmxHead);
		const cssResult = processCSSLinks(htmxHead);
		waitForCSSAndUpdate(cssResult, updateHTMXBodyAfterCSS);
	} else {
		updateHTMXBodyAfterCSS();
	}
};

export const handleHTMXUpdate = (message: {
	data: {
		html?: string | { body?: string; head?: string } | null;
	};
}) => {
	const htmxFrameworkCheck = detectCurrentFramework();
	if (htmxFrameworkCheck !== 'htmx') return;

	if (window.__REACT_ROOT__) {
		window.__REACT_ROOT__ = undefined;
	}

	sessionStorage.setItem('__HMR_ACTIVE__', 'true');

	const htmxDomState = saveDOMState(document.body);
	const { body: htmxBody, head: htmxHead } = parseHTMXMessage(
		message.data.html
	);

	if (!htmxBody) {
		sessionStorage.removeItem('__HMR_ACTIVE__');

		return;
	}

	handleHTMXBodyUpdate(htmxBody, htmxHead, htmxDomState);
};

const cloneHmrListenerElements = (container: HTMLElement) => {
	container
		.querySelectorAll('[data-hmr-listeners-attached]')
		.forEach((elem) => {
			const cloned = elem.cloneNode(true) as Element; // eslint-disable-line @typescript-eslint/consistent-type-assertions
			if (elem.parentNode) {
				elem.parentNode.replaceChild(cloned, elem);
			}
			cloned.removeAttribute('data-hmr-listeners-attached');
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

const addNewScripts = (container: HTMLElement, newScripts: ScriptInfo[]) => {
	newScripts.forEach((scriptInfo) => {
		const newScript = document.createElement('script');
		const separator = scriptInfo.src.includes('?') ? '&' : '?';
		newScript.src = `${scriptInfo.src + separator}t=${Date.now()}`;
		newScript.type = scriptInfo.type;
		container.appendChild(newScript);
	});
};

const replaceInlineScript = (script: Element) => {
	if (script.hasAttribute('data-hmr-client')) {
		return;
	}

	const newScript = document.createElement('script');
	newScript.textContent = script.textContent || '';
	newScript.type = script.getAttribute('type') || 'text/javascript';
	if (script.parentNode) {
		script.parentNode.replaceChild(newScript, script);
	}
};

const reExecuteScripts = (container: HTMLElement, newScripts: ScriptInfo[]) => {
	removeOldScripts(container);
	addNewScripts(container, newScripts);

	const inlineScripts = container.querySelectorAll('script:not([src])');
	inlineScripts.forEach(replaceInlineScript);
};

const handleScriptsAndStructureChange = (
	container: HTMLElement,
	newScripts: ScriptInfo[]
) => {
	cloneHmrListenerElements(container);
	reExecuteScripts(container, newScripts);
};

const restoreCounterSpan = (
	container: HTMLElement,
	count: number | undefined
) => {
	const newCountSpan = container.querySelector('#count');
	if (newCountSpan && count !== undefined) {
		newCountSpan.textContent = String(count);
	}
};

const updateHTMXBody = (
	htmxBody: string,
	htmxDomState: ReturnType<typeof saveDOMState>,
	container: HTMLElement
) => {
	if (!container) return;

	const countSpan = container.querySelector('#count');
	const countValue = countSpan
		? parseInt(countSpan.textContent || '0', 10)
		: 0;

	const savedState: HTMXSavedState = {
		componentState: { count: countValue },
		forms: saveFormState(),
		scroll: saveScrollState()
	};

	const existingScripts = collectScripts(container);

	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = htmxBody;

	if (savedState.componentState.count !== undefined) {
		restoreCounterSpan(tempDiv, savedState.componentState.count);
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

	requestAnimationFrame(() => {
		restoreFormState(savedState.forms);
		restoreScrollState(savedState.scroll);
		restoreCounterSpan(container, savedState.componentState.count);
		restoreDOMState(container, htmxDomState);

		if (scriptsChanged || htmlStructureChanged) {
			handleScriptsAndStructureChange(container, newScripts);
		}

		if (window.htmx) {
			window.htmx.process(container);
		}
	});
	sessionStorage.removeItem('__HMR_ACTIVE__');
};

/* Shared helpers */

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
		const [oldBeforeQuery = ''] = oldScript.src.split('?');
		const [oldSrcBase] = oldBeforeQuery.split('&');
		const newScript = newScripts[idx];
		if (!newScript) return true;
		const [newBeforeQuery = ''] = newScript.src.split('?');
		const [newSrcBase] = newBeforeQuery.split('&');

		return oldSrcBase !== newSrcBase;
	});

const normalizeHTMLForComparison = (element: HTMLElement) => {
	const clone = element.cloneNode(true) as HTMLElement; // eslint-disable-line @typescript-eslint/consistent-type-assertions
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

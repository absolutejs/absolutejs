/* CSS reload/preload utilities for HMR */

import type { CSSUpdateResult } from '../../../types/client';
import { hmrState } from '../../../types/client';
import {
	CSS_ERROR_RESOLVE_DELAY_MS,
	CSS_MAX_CHECK_ATTEMPTS,
	CSS_MAX_PARSE_TIMEOUT_MS,
	CSS_SHEET_READY_TIMEOUT_MS,
	DOM_UPDATE_DELAY_MS,
	RAF_BATCH_COUNT
} from '../../constants';

export const getCSSBaseName = (href: string) => {
	const fileName = href.split('?')[0]!.split('/').pop() || '';

	return fileName.split('.')[0]!;
};

const baseNamesMatch = (baseA: string, baseB: string) =>
	baseA === baseB || baseA.includes(baseB) || baseB.includes(baseA);

const findMatchingLink = (baseNew: string) => {
	const links = document.head.querySelectorAll('link[rel="stylesheet"]');
	for (const existing of links) {
		const existingHref =
			(existing as HTMLLinkElement).getAttribute('href') || '';
		const baseExisting = getCSSBaseName(existingHref);
		if (baseNamesMatch(baseExisting, baseNew)) {
			return existing as HTMLLinkElement;
		}
	}

	return null;
};

const createTimestampedLink = (href: string) => {
	const newLinkElement = document.createElement('link');
	newLinkElement.rel = 'stylesheet';
	newLinkElement.media = 'print';
	const newHref = `${href + (href.includes('?') ? '&' : '?')}t=${Date.now()}`;
	newLinkElement.href = newHref;

	return { newHref, newLinkElement };
};

const processNewLink = (
	newLink: Element,
	linksToRemove: HTMLLinkElement[],
	linksToActivate: HTMLLinkElement[],
	linksToWaitFor: Promise<void>[]
) => {
	const href = newLink.getAttribute('href');
	if (!href) return;

	const baseNew = getCSSBaseName(href);
	const existingLink = findMatchingLink(baseNew);

	if (!existingLink) {
		const { newHref, newLinkElement } = createTimestampedLink(href);
		linksToActivate.push(newLinkElement);
		const loadPromise = createCSSLoadPromise(newLinkElement, newHref);
		document.head.appendChild(newLinkElement);
		linksToWaitFor.push(loadPromise);

		return;
	}

	const existingHrefAttr = existingLink.getAttribute('href');
	const existingHref = existingHrefAttr ? existingHrefAttr.split('?')[0] : '';
	const newHrefBase = href.split('?')[0];
	if (existingHref === newHrefBase) return;

	const { newHref, newLinkElement } = createTimestampedLink(href);
	linksToRemove.push(existingLink);
	linksToActivate.push(newLinkElement);
	const loadPromise = createCSSLoadPromise(newLinkElement, newHref);
	document.head.appendChild(newLinkElement);
	linksToWaitFor.push(loadPromise);
};

export const processCSSLinks = (headHTML: string) => {
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = headHTML;
	const newStylesheets = tempDiv.querySelectorAll('link[rel="stylesheet"]');
	const existingStylesheets = Array.from(
		document.head.querySelectorAll<HTMLLinkElement>(
			'link[rel="stylesheet"]'
		)
	);

	const newHrefs = Array.from(newStylesheets).map((link) => {
		const href = link.getAttribute('href') || '';

		return getCSSBaseName(href);
	});

	const linksToRemove: HTMLLinkElement[] = [];
	const linksToWaitFor: Promise<void>[] = [];
	const linksToActivate: HTMLLinkElement[] = [];

	newStylesheets.forEach((newLink) => {
		processNewLink(newLink, linksToRemove, linksToActivate, linksToWaitFor);
	});

	existingStylesheets.forEach((existingLink) => {
		const existingHref = existingLink.getAttribute('href') || '';
		const baseExisting = getCSSBaseName(existingHref);
		const stillExists = newHrefs.some((newBase) =>
			baseNamesMatch(baseExisting, newBase)
		);
		if (stillExists) return;

		const wasHandled = Array.from(newStylesheets).some((newLink) => {
			const newHref = newLink.getAttribute('href') || '';
			const baseNewLocal = getCSSBaseName(newHref);

			return baseNamesMatch(baseExisting, baseNewLocal);
		});

		if (!wasHandled) {
			linksToRemove.push(existingLink);
		}
	});

	return { linksToActivate, linksToRemove, linksToWaitFor };
};

const findManifestHref = (
	manifest: Record<string, string>,
	baseName: string
) => {
	const manifestKey = `${baseName
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('')}CSS`;

	if (manifest[manifestKey]) {
		return manifest[manifestKey];
	}

	for (const [key, value] of Object.entries(manifest)) {
		if (key.endsWith('CSS') && value.includes(baseName)) {
			return value;
		}
	}

	return null;
};

const updateStylesheetLink = (
	link: Element,
	manifest: Record<string, string>
) => {
	const href = (link as HTMLLinkElement).getAttribute('href');
	if (!href || href.includes('htmx.min.js')) return;

	let newHref: string | null = null;
	if (manifest) {
		const baseName = getCSSBaseName(href);
		newHref = findManifestHref(manifest, baseName);
	}

	if (newHref && newHref !== href) {
		(link as HTMLLinkElement).href = `${newHref}?t=${Date.now()}`;
	} else {
		const url = new URL(href, window.location.origin);
		url.searchParams.set('t', Date.now().toString());
		(link as HTMLLinkElement).href = url.toString();
	}
};

export const reloadCSSStylesheets = (manifest: Record<string, string>) => {
	const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
	stylesheets.forEach((link) => {
		updateStylesheetLink(link, manifest);
	});
};

const createCSSLoadPromise = (linkElement: HTMLLinkElement, newHref: string) =>
	new Promise<void>((resolve) => {
		let resolved = false;
		const doResolve = function () {
			if (resolved) return;
			resolved = true;
			resolve();
		};

		const verifyCSSOM = function () {
			try {
				const sheets = Array.from(document.styleSheets);

				return sheets.some(
					(sheet) =>
						sheet.href &&
						sheet.href.includes(newHref.split('?')[0]!)
				);
			} catch {
				return false;
			}
		};

		linkElement.onload = function () {
			let checkCount = 0;
			const checkCSSOM = function () {
				checkCount++;
				if (verifyCSSOM() || checkCount > CSS_MAX_CHECK_ATTEMPTS) {
					doResolve();
				} else {
					requestAnimationFrame(checkCSSOM);
				}
			};
			requestAnimationFrame(checkCSSOM);
		};

		linkElement.onerror = function () {
			setTimeout(() => {
				doResolve();
			}, CSS_ERROR_RESOLVE_DELAY_MS);
		};

		setTimeout(() => {
			if (linkElement.sheet && !resolved) {
				doResolve();
			}
		}, CSS_SHEET_READY_TIMEOUT_MS);

		setTimeout(() => {
			if (!resolved) {
				doResolve();
			}
		}, CSS_MAX_PARSE_TIMEOUT_MS);
	});

const removeLinks = (linksToRemove: HTMLLinkElement[]) => {
	linksToRemove.forEach((link) => {
		if (link.parentNode) {
			link.remove();
		}
	});
};

const activateLinks = (linksToActivate: HTMLLinkElement[]) => {
	linksToActivate.forEach((link) => {
		link.media = 'all';
	});
};

const chainRAF = (depth: number, callback: () => void) => {
	if (depth <= 0) {
		callback();

		return;
	}
	requestAnimationFrame(() => {
		chainRAF(depth - 1, callback);
	});
};

/* Coordinate CSS load with body update: waits for CSS, patches body,
   activates new CSS, removes old CSS. Handles first-update delay. */
export const waitForCSSAndUpdate = (
	cssResult: CSSUpdateResult,
	updateBody: () => void
) => {
	const { linksToActivate, linksToRemove, linksToWaitFor } = cssResult;

	if (linksToWaitFor.length > 0) {
		Promise.all(linksToWaitFor).then(() => {
			setTimeout(() => {
				chainRAF(RAF_BATCH_COUNT, () => {
					updateBody();
					activateLinks(linksToActivate);
					requestAnimationFrame(() => {
						removeLinks(linksToRemove);
						if (hmrState.isFirstHMRUpdate) {
							hmrState.isFirstHMRUpdate = false;
						}
					});
				});
			}, DOM_UPDATE_DELAY_MS);
		});

		return;
	}

	const doUpdate = function () {
		chainRAF(RAF_BATCH_COUNT, () => {
			updateBody();
			requestAnimationFrame(() => {
				removeLinks(linksToRemove);
			});
		});
	};

	if (hmrState.isFirstHMRUpdate) {
		hmrState.isFirstHMRUpdate = false;
		setTimeout(doUpdate, DOM_UPDATE_DELAY_MS);
	} else {
		doUpdate();
	}
};

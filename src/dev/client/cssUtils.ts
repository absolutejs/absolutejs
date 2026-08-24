/* CSS reload/preload utilities for HMR */

import type { CSSUpdateResult } from '../../../types/client';
import {
	CSS_ERROR_RESOLVE_DELAY_MS,
	CSS_MAX_CHECK_ATTEMPTS,
	CSS_MAX_PARSE_TIMEOUT_MS,
	CSS_SHEET_READY_TIMEOUT_MS,
	DOM_UPDATE_DELAY_MS,
	RAF_BATCH_COUNT
} from './constants';
import { hmrState } from './hmrState';

export const getCSSBaseName = (href: string) => {
	const fileName = href.split('?')[0]?.split('/').pop() || '';

	return fileName.split('.')[0] ?? '';
};

const baseNamesMatch = (baseA: string, baseB: string) =>
	baseA === baseB || baseA.includes(baseB) || baseB.includes(baseA);

const findMatchingLink = (baseNew: string) => {
	const links = document.head.querySelectorAll('link[rel="stylesheet"]');
	for (const existing of links) {
		if (!(existing instanceof HTMLLinkElement)) continue;
		const existingHref = existing.getAttribute('href') || '';
		const baseExisting = getCSSBaseName(existingHref);
		if (baseNamesMatch(baseExisting, baseNew)) {
			return existing;
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
	const [newHrefBase] = href.split('?');
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

const replaceStylesheetLink = (
	existingLink: HTMLLinkElement,
	newHref: string,
	attempt = 0
) => {
	const replacement = existingLink.cloneNode(true);
	if (!(replacement instanceof HTMLLinkElement)) {
		return Promise.resolve(false);
	}
	const { promise, resolve } = Promise.withResolvers<boolean>();
	let settled = false;
	const finish = (applied: boolean) => {
		if (settled) return;
		settled = true;
		if (applied) existingLink.remove();
		else replacement.remove();
		resolve(applied);
	};
	replacement.onload = () => finish(true);
	replacement.onerror = () => {
		if (attempt >= 1) {
			finish(false);

			return;
		}
		replacement.remove();
		settled = true;
		void replaceStylesheetLink(
			existingLink,
			`${newHref}${newHref.includes('?') ? '&' : '?'}retry=${Date.now()}`,
			attempt + 1
		).then(resolve);
	};
	replacement.href = newHref;
	existingLink.after(replacement);
	setTimeout(() => {
		if (replacement.sheet) finish(true);
	}, CSS_SHEET_READY_TIMEOUT_MS);
	setTimeout(
		() => finish(Boolean(replacement.sheet)),
		CSS_MAX_PARSE_TIMEOUT_MS
	);

	return promise;
};

const updateStylesheetLink = (
	link: Element,
	manifest: Record<string, string>
) => {
	if (!(link instanceof HTMLLinkElement)) return Promise.resolve(true);
	const href = link.getAttribute('href');
	if (!href || href.includes('htmx.min.js')) return Promise.resolve(true);

	let newHref: string | null = null;
	if (manifest) {
		const baseName = getCSSBaseName(href);
		newHref = findManifestHref(manifest, baseName);
	}
	const currentUrl = new URL(href, window.location.href);
	if (!newHref && currentUrl.origin !== window.location.origin) {
		return Promise.resolve(true);
	}

	let replacementHref: string;
	if (newHref && newHref !== href) {
		replacementHref = `${newHref}?t=${Date.now()}`;
	} else {
		currentUrl.searchParams.set('t', Date.now().toString());
		replacementHref = currentUrl.toString();
	}

	return replaceStylesheetLink(link, replacementHref);
};

export const reloadCSSStylesheets = (manifest: Record<string, string>) => {
	const stylesheets = Array.from(
		document.querySelectorAll('link[rel="stylesheet"]')
	);

	return Promise.all(
		stylesheets.map((link) => updateStylesheetLink(link, manifest))
	).then((results) => results.every(Boolean));
};

export const swapCSSStylesheet = (
	cssUrl: string,
	matches: (href: string) => boolean
) => {
	const existingLink = Array.from(
		document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
	).find((link) => matches(link.getAttribute('href') ?? ''));
	if (!existingLink) return Promise.resolve(false);

	return replaceStylesheetLink(
		existingLink,
		`${cssUrl}${cssUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
	);
};

const createCSSLoadPromise = (
	linkElement: HTMLLinkElement,
	newHref: string
) => {
	const { promise, resolve } = Promise.withResolvers<void>();
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
					sheet.href.includes(newHref.split('?')[0] ?? '')
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

	return promise;
};

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
	updateBody: () => void | Promise<void>
) => {
	const { linksToActivate, linksToRemove, linksToWaitFor } = cssResult;
	const { promise, reject, resolve } = Promise.withResolvers<void>();
	const doUpdate = () => {
		chainRAF(RAF_BATCH_COUNT, () => {
			let updateResult: void | Promise<void>;
			try {
				updateResult = updateBody();
				activateLinks(linksToActivate);
			} catch (error) {
				reject(error);

				return;
			}
			void Promise.resolve(updateResult).then(
				() => {
					requestAnimationFrame(() => {
						removeLinks(linksToRemove);
						hmrState.isFirstHMRUpdate = false;
						resolve();
					});
				},
				(error: unknown) => reject(error)
			);
		});
	};
	const scheduleUpdate = () => {
		if (hmrState.isFirstHMRUpdate || linksToWaitFor.length > 0) {
			setTimeout(doUpdate, DOM_UPDATE_DELAY_MS);
		} else {
			doUpdate();
		}
	};
	if (linksToWaitFor.length > 0) {
		void Promise.all(linksToWaitFor).then(scheduleUpdate, reject);
	} else {
		scheduleUpdate();
	}

	return promise;
};

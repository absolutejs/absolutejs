/* CSS reload/preload utilities for HMR */

import type { CSSUpdateResult } from '../../../types/client';
import { hmrState } from '../../../types/client';

export const getCSSBaseName = (href: string) => {
	const fileName = href.split('?')[0]!.split('/').pop() || '';

	return fileName.split('.')[0]!;
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
		const href = newLink.getAttribute('href');
		if (!href) return;

		const baseNew = getCSSBaseName(href);

		let existingLink: HTMLLinkElement | null = null;
		document.head
			.querySelectorAll('link[rel="stylesheet"]')
			.forEach((existing) => {
				const existingHref =
					(existing as HTMLLinkElement).getAttribute('href') || '';
				const baseExisting = getCSSBaseName(existingHref);
				if (
					baseExisting === baseNew ||
					baseExisting.includes(baseNew) ||
					baseNew.includes(baseExisting)
				) {
					existingLink = existing as HTMLLinkElement;
				}
			});

		if (existingLink) {
			const existingHrefAttr = (
				existingLink as HTMLLinkElement
			).getAttribute('href');
			const existingHref = existingHrefAttr
				? existingHrefAttr.split('?')[0]
				: '';
			const newHrefBase = href.split('?')[0];
			if (existingHref !== newHrefBase) {
				const newLinkElement = document.createElement('link');
				newLinkElement.rel = 'stylesheet';
				newLinkElement.media = 'print';
				const newHref = `${href + (href.includes('?') ? '&' : '?')}t=${Date.now()}`;
				newLinkElement.href = newHref;

				linksToRemove.push(existingLink as HTMLLinkElement);
				linksToActivate.push(newLinkElement);

				const loadPromise = createCSSLoadPromise(
					newLinkElement,
					newHref
				);
				document.head.appendChild(newLinkElement);
				linksToWaitFor.push(loadPromise);
			}
		} else {
			const newLinkElement = document.createElement('link');
			newLinkElement.rel = 'stylesheet';
			newLinkElement.media = 'print';
			const newHref = `${href + (href.includes('?') ? '&' : '?')}t=${Date.now()}`;
			newLinkElement.href = newHref;

			linksToActivate.push(newLinkElement);

			const loadPromise = createCSSLoadPromise(newLinkElement, newHref);
			document.head.appendChild(newLinkElement);
			linksToWaitFor.push(loadPromise);
		}
	});

	existingStylesheets.forEach((existingLink) => {
		const existingHref = existingLink.getAttribute('href') || '';
		const baseExisting = getCSSBaseName(existingHref);
		const stillExists = newHrefs.some(
			(newBase) =>
				baseExisting === newBase ||
				baseExisting.includes(newBase) ||
				newBase.includes(baseExisting)
		);

		if (!stillExists) {
			const wasHandled = Array.from(newStylesheets).some((newLink) => {
				const newHref = newLink.getAttribute('href') || '';
				const baseNewLocal = getCSSBaseName(newHref);

				return (
					baseExisting === baseNewLocal ||
					baseExisting.includes(baseNewLocal) ||
					baseNewLocal.includes(baseExisting)
				);
			});

			if (!wasHandled) {
				linksToRemove.push(existingLink);
			}
		}
	});

	return { linksToActivate, linksToRemove, linksToWaitFor };
};
export const reloadCSSStylesheets = (manifest: Record<string, string>) => {
	const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
	stylesheets.forEach((link) => {
		const href = (link as HTMLLinkElement).getAttribute('href');
		if (!href || href.includes('htmx.min.js')) return;

		let newHref: string | null = null;
		if (manifest) {
			const baseName = getCSSBaseName(href);
			const manifestKey = `${baseName
				.split('-')
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join('')}CSS`;

			if (manifest[manifestKey]) {
				newHref = manifest[manifestKey]!;
			} else {
				for (const [key, value] of Object.entries(manifest)) {
					if (key.endsWith('CSS') && value.includes(baseName)) {
						newHref = value;
						break;
					}
				}
			}
		}

		if (newHref && newHref !== href) {
			(link as HTMLLinkElement).href = `${newHref}?t=${Date.now()}`;
		} else {
			const url = new URL(href, window.location.origin);
			url.searchParams.set('t', Date.now().toString());
			(link as HTMLLinkElement).href = url.toString();
		}
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
				if (verifyCSSOM() || checkCount > 10) {
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
			}, 50);
		};

		setTimeout(() => {
			if (linkElement.sheet && !resolved) {
				doResolve();
			}
		}, 100);

		setTimeout(() => {
			if (!resolved) {
				doResolve();
			}
		}, 500);
	});

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
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							updateBody();
							linksToActivate.forEach((link) => {
								link.media = 'all';
							});
							requestAnimationFrame(() => {
								linksToRemove.forEach((link) => {
									if (link.parentNode) {
										link.remove();
									}
								});
								if (hmrState.isFirstHMRUpdate) {
									hmrState.isFirstHMRUpdate = false;
								}
							});
						});
					});
				});
			}, 50);
		});
	} else {
		const doUpdate = function () {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						updateBody();
						requestAnimationFrame(() => {
							linksToRemove.forEach((link) => {
								if (link.parentNode) {
									link.remove();
								}
							});
						});
					});
				});
			});
		};

		if (hmrState.isFirstHMRUpdate) {
			hmrState.isFirstHMRUpdate = false;
			setTimeout(doUpdate, 50);
		} else {
			doUpdate();
		}
	}
};

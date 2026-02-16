/* CSS reload/preload utilities for HMR */

import type { CSSUpdateResult } from './types';
import { hmrState } from './types';

export function getCSSBaseName(href: string): string {
	const fileName = href.split('?')[0]!.split('/').pop() || '';
	return fileName.split('.')[0]!;
}

export function reloadCSSStylesheets(manifest: Record<string, string>): void {
	const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
	stylesheets.forEach(function (link) {
		const href = (link as HTMLLinkElement).getAttribute('href');
		if (!href || href.includes('htmx.min.js')) return;

		let newHref: string | null = null;
		if (manifest) {
			const baseName = href
				.split('/')
				.pop()!
				.replace(/\.[^.]*$/, '');
			const manifestKey =
				baseName
					.split('-')
					.map(function (part) {
						return part.charAt(0).toUpperCase() + part.slice(1);
					})
					.join('') + 'CSS';

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
			(link as HTMLLinkElement).href = newHref + '?t=' + Date.now();
		} else {
			const url = new URL(href, window.location.origin);
			url.searchParams.set('t', Date.now().toString());
			(link as HTMLLinkElement).href = url.toString();
		}
	});
}

/* Shared CSS preload/swap logic used by HTML and HTMX handlers.
   Returns tracking arrays for coordinating CSS load with body patching. */
export function processCSSLinks(headHTML: string): CSSUpdateResult {
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = headHTML;
	const newStylesheets = tempDiv.querySelectorAll('link[rel="stylesheet"]');
	const existingStylesheets = Array.from(
		document.head.querySelectorAll<HTMLLinkElement>(
			'link[rel="stylesheet"]'
		)
	);

	const newHrefs = Array.from(newStylesheets).map(function (link) {
		const href = link.getAttribute('href') || '';
		return getCSSBaseName(href);
	});

	const linksToRemove: HTMLLinkElement[] = [];
	const linksToWaitFor: Promise<void>[] = [];
	const linksToActivate: HTMLLinkElement[] = [];

	newStylesheets.forEach(function (newLink) {
		const href = newLink.getAttribute('href');
		if (!href) return;

		const baseNew = getCSSBaseName(href);

		let existingLink: HTMLLinkElement | null = null;
		document.head
			.querySelectorAll('link[rel="stylesheet"]')
			.forEach(function (existing) {
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
				const newHref =
					href + (href.includes('?') ? '&' : '?') + 't=' + Date.now();
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
			const newHref =
				href + (href.includes('?') ? '&' : '?') + 't=' + Date.now();
			newLinkElement.href = newHref;

			linksToActivate.push(newLinkElement);

			const loadPromise = createCSSLoadPromise(newLinkElement, newHref);
			document.head.appendChild(newLinkElement);
			linksToWaitFor.push(loadPromise);
		}
	});

	existingStylesheets.forEach(function (existingLink) {
		const existingHref = existingLink.getAttribute('href') || '';
		const baseExisting = getCSSBaseName(existingHref);
		const stillExists = newHrefs.some(function (newBase) {
			return (
				baseExisting === newBase ||
				baseExisting.includes(newBase) ||
				newBase.includes(baseExisting)
			);
		});

		if (!stillExists) {
			const wasHandled = Array.from(newStylesheets).some(
				function (newLink) {
					const newHref = newLink.getAttribute('href') || '';
					const baseNewLocal = getCSSBaseName(newHref);
					return (
						baseExisting === baseNewLocal ||
						baseExisting.includes(baseNewLocal) ||
						baseNewLocal.includes(baseExisting)
					);
				}
			);

			if (!wasHandled) {
				linksToRemove.push(existingLink);
			}
		}
	});

	return { linksToActivate, linksToRemove, linksToWaitFor };
}

function createCSSLoadPromise(
	linkElement: HTMLLinkElement,
	newHref: string
): Promise<void> {
	return new Promise<void>(function (resolve) {
		let resolved = false;
		const doResolve = function () {
			if (resolved) return;
			resolved = true;
			resolve();
		};

		const verifyCSSOM = function () {
			try {
				const sheets = Array.from(document.styleSheets);
				return sheets.some(function (sheet) {
					return (
						sheet.href &&
						sheet.href.includes(newHref.split('?')[0]!)
					);
				});
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
			setTimeout(function () {
				doResolve();
			}, 50);
		};

		setTimeout(function () {
			if (linkElement.sheet && !resolved) {
				doResolve();
			}
		}, 100);

		setTimeout(function () {
			if (!resolved) {
				doResolve();
			}
		}, 500);
	});
}

/* Coordinate CSS load with body update: waits for CSS, patches body,
   activates new CSS, removes old CSS. Handles first-update delay. */
export function waitForCSSAndUpdate(
	cssResult: CSSUpdateResult,
	updateBody: () => void
): void {
	const { linksToActivate, linksToRemove, linksToWaitFor } = cssResult;

	if (linksToWaitFor.length > 0) {
		Promise.all(linksToWaitFor).then(function () {
			setTimeout(function () {
				requestAnimationFrame(function () {
					requestAnimationFrame(function () {
						requestAnimationFrame(function () {
							updateBody();
							linksToActivate.forEach(function (link) {
								link.media = 'all';
							});
							requestAnimationFrame(function () {
								linksToRemove.forEach(function (link) {
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
			requestAnimationFrame(function () {
				requestAnimationFrame(function () {
					requestAnimationFrame(function () {
						updateBody();
						requestAnimationFrame(function () {
							linksToRemove.forEach(function (link) {
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
}

/* A page with no framework, refreshed without being replaced.
 *
 * A React, Svelte, Vue or Angular page is refreshed by handing it new
 * props (refreshInPlace.ts). An HTML or HTMX page has no props and no
 * component to hand them to: its data is in its markup, and its state is
 * in the document — what was typed, what is open, what a script
 * attached. So it is refreshed by fetching the page again and MORPHING
 * the document on screen into it (morph.ts), which keeps every node
 * that is still wanted and everything attached to it.
 *
 * As with props, this is done only when it is certain to be right. A
 * redirect, a page whose stylesheets or islands are no longer the same
 * set, a response that is not a document: each is declined, and the
 * caller refreshes the whole page the way it always did. */

import type {
	DocumentNavigationEventDetail,
	DocumentNavigationOutcome
} from '../../types/navigation';
import { morphBody } from './morph';
import { announce, refreshState } from './refreshInPlace';

const ISLAND = '[data-island="true"]';
const STYLESHEET = 'link[rel~="stylesheet"][href]';

/** Whether the page on screen has no framework app: nothing registered
 *  that it is ready, and no props or request context was sent for one.
 *  A framework page whose data cannot be refreshed in place — an Angular
 *  page that copies its context — is NOT one of these: a framework owns
 *  its markup, and morphing it would pull the page out from under it. */
export const isDocumentPage = () =>
	Reflect.get(window, '__ABSOLUTE_PAGE_READY__') === undefined &&
	Reflect.get(window, '__INITIAL_PROPS__') === undefined &&
	!Object.prototype.hasOwnProperty.call(
		window,
		'__ABS_ANGULAR_REQUEST_CONTEXT__'
	);

const stylesheetsOf = (target: Document) =>
	Array.from(target.querySelectorAll<HTMLLinkElement>(STYLESHEET))
		.map(
			(link) =>
				new URL(link.getAttribute('href') ?? '', location.href).href
		)
		.sort()
		.join('\n');

/* The same page, as far as can be told from outside it: it loads the
 * same stylesheets and holds the same number of islands. A different
 * set of either is a page that needs more than its markup changed —
 * styles loaded, islands mounted or disposed — which is the whole-page
 * refresh's work. */
const isSamePage = (next: Document) =>
	stylesheetsOf(next) === stylesheetsOf(document) &&
	next.querySelectorAll(ISLAND).length ===
		document.querySelectorAll(ISLAND).length;

const readDocument = async (response: Response) => {
	const contentType = response.headers.get('content-type') ?? '';
	if (
		!response.ok ||
		response.redirected ||
		!contentType.includes('text/html')
	) {
		await response.body?.cancel().catch(() => undefined);

		return undefined;
	}
	const next = new DOMParser().parseFromString(
		await response.text(),
		'text/html'
	);

	return isSamePage(next) ? next : undefined;
};

/* HTMX wires up `hx-*` attributes when it first sees an element. Markup
 * that arrived in a refresh has not been seen. */
const processHtmx = () => {
	const htmx: unknown = Reflect.get(window, 'htmx');
	if (typeof htmx !== 'object' || htmx === null) return;
	const process: unknown = Reflect.get(htmx, 'process');
	if (typeof process === 'function')
		Reflect.apply(process, htmx, [document.body]);
};

/** Refreshes a page that has no framework by morphing it into a fresh
 *  copy of itself.
 *
 *  Resolves to `'updated'` when the document was brought up to date in
 *  place, `'cancelled'` when a listener refused the refresh,
 *  `'superseded'` when a newer refresh started first — and to
 *  `undefined` when it could not be done this way and the caller should
 *  refresh the whole page instead. It never throws. */
export const refreshDocumentInPlace = async () => {
	const state = refreshState();
	state.latest += 1;
	const mine = state.latest;
	const detail: DocumentNavigationEventDetail = {
		type: 'refresh',
		url: window.location.href
	};
	const done = (outcome: DocumentNavigationOutcome) => outcome;
	if (!announce('absolute:before-navigate', detail, true))
		return done('cancelled');
	const response = await fetch(window.location.href, {
		cache: 'reload',
		credentials: 'same-origin',
		headers: { Accept: 'text/html' }
	}).catch(() => undefined);
	const next = response ? await readDocument(response) : undefined;
	if (mine !== state.latest) return done('superseded');
	if (!next) return undefined;
	try {
		morphBody(next);
	} catch {
		// Half-morphed is the one state worse than not refreshed: the
		// whole-page refresh puts the document right.
		return undefined;
	}
	if (next.title !== '') document.title = next.title;
	processHtmx();
	announce('absolute:after-navigate', detail, false);

	return done('updated');
};

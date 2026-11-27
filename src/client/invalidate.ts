import type { DocumentNavigationOutcome } from '../../types/navigation';
import { isDocumentPage, refreshDocumentInPlace } from './refreshDocument';
import { readPageUpdate, refreshInPlace } from './refreshInPlace';

/* `invalidate()`: the page's data changed, show the page again.
 *
 * A page gets its data once, from its route's `load` (or its handler's
 * props), as it is rendered. After the browser changes that data — a
 * form action, a `fetch` to an API route — the page on screen is a
 * picture of how things were. This asks the server for the page again
 * and puts the answer in place of the one showing: same address, same
 * history entry, same scroll position, no view transition.
 *
 * There is deliberately no copy of the data kept in the browser to go
 * stale and be patched. The server stays the one place a page's data is
 * assembled, so a refreshed page is exactly the page a reload would
 * give, for every kind of page there is — React, Svelte, Vue, Angular,
 * HTML, HTMX.
 *
 * What that costs: the page is mounted again, so state the page's own
 * components held (an open menu, half-typed text) starts over. An
 * island marked `persist` keeps its state, as it does across any soft
 * navigation.
 *
 * Found through the same global the navigation layer registers itself
 * under, rather than by importing that module: this file ships in the
 * general client entry and must not pull the whole layer in with it. */

const NAVIGATION_RUNTIME = Symbol.for('absolutejs.navigation');

const OUTCOMES = new Set<unknown>([
	'cancelled',
	'reloaded',
	'superseded',
	'swapped',
	'updated'
]);

const isOutcome = (value: unknown): value is DocumentNavigationOutcome =>
	OUTCOMES.has(value);

const readRefresh = () => {
	const installed: unknown = Reflect.get(globalThis, NAVIGATION_RUNTIME);
	if (typeof installed !== 'object' || installed === null) return undefined;
	const refresh: unknown = Reflect.get(installed, 'refresh');

	return typeof refresh === 'function' ? refresh : undefined;
};

const reloaded = () => {
	const outcome: DocumentNavigationOutcome = 'reloaded';
	window.location.reload();

	return outcome;
};

/** Fetch the current page again and show the result in its place.
 *
 * Call it after changing data the page shows:
 *
 *     await fetch('/api/todos', { body, method: 'POST' });
 *     await invalidate();
 *
 * Resolves to how it ended: `'updated'` when the mounted page was given
 * new data and nothing was torn down, `'swapped'` when the page was
 * replaced in place, `'reloaded'` when the browser was asked to load it instead —
 * which is what happens on a page without the navigation layer, or one
 * that cannot be torn down — `'superseded'` when a newer navigation or
 * refresh started first, and `'cancelled'` when an
 * `absolute:before-navigate` listener refused it. Does nothing outside a
 * browser. */
export const invalidate = async () => {
	if (typeof window === 'undefined') {
		const outcome: DocumentNavigationOutcome = 'cancelled';

		return outcome;
	}
	// First choice: hand the mounted page new props, so that nothing it
	// is holding is lost (refreshInPlace.ts). Whatever it declines —
	// a page with no way to take props, a redirect, a different page —
	// is refreshed whole, below.
	const update = readPageUpdate();
	const inPlace = update ? await refreshInPlace(update) : undefined;
	if (inPlace !== undefined) return inPlace;
	// A page with no framework has no props to be handed: the document
	// on screen is morphed into a fresh copy of itself, which keeps
	// what was typed, what is open and what scripts attached
	// (refreshDocument.ts).
	const morphed =
		!update && isDocumentPage()
			? await refreshDocumentInPlace()
			: undefined;
	if (morphed !== undefined) return morphed;
	const refresh = readRefresh();
	if (!refresh) return reloaded();
	const result: unknown = await Reflect.apply(refresh, undefined, []);

	return isOutcome(result) ? result : reloaded();
};

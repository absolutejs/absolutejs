import { isSignal, signal, type Signal } from '@angular/core';
import { usePageContext } from './usePageContext';

/* The page's data as a SIGNAL, which is what lets `invalidate()` refresh
 * an Angular page without taking it down.
 *
 * `usePageContext()` hands a page the object the handler passed, and a
 * page usually copies what it needs out of it as it is constructed:
 *
 *     private ctx = usePageContext<Context>();
 *     count = this.ctx.count;
 *
 * Nothing can change `count` afterwards — it is a field holding a copy —
 * so new data cannot be given to such a page. Updating the parts that
 * read the object directly and leaving the copies would show a page
 * made of two answers, with nothing to say so. A page that reads its
 * data that way is therefore refreshed the way it always was: fetched
 * whole and mounted again.
 *
 * A signal has no such problem. The template reads `data().count`, a
 * `computed` derives from it, and when a refresh sets the signal Angular
 * re-renders exactly what read it. So in-place refresh is offered to
 * the pages that read their data through this, and only those.
 *
 * The signal the page's client entry created is found through a global
 * rather than injected: the entry and this module can be bundled
 * separately, and an injection token created in each would be two
 * tokens. On the server there is no client entry and no refresh, so the
 * request's own context is wrapped for the length of the render. */

const PAGE_DATA_KEY = Symbol.for('absolutejs.angularPageData');

/* What the client entry stored is this page's data; its shape is the
 * handler's, which the caller's generic names — the same agreement
 * `usePageContext` rests on. */
const isPageData = <T>(value: unknown): value is Signal<T> => isSignal(value);

/** The data the backend handler passed as `requestContext`, as a signal
 *  that changes when the page is refreshed.
 *
 *      private data = usePageData<Context>();
 *      count = computed(() => this.data().count);
 *
 *  Read it in the template or through `computed`, not into a plain
 *  field, and `invalidate()` updates the page in place: its own state is
 *  kept and only what read the data is re-rendered. A page that also
 *  calls `usePageContext()` is refreshed whole instead, since it may
 *  hold copies that cannot be updated.
 *
 *  Must be called in an Angular injection context. */
export const usePageData = <T>() => {
	const shared: unknown =
		typeof window === 'undefined'
			? undefined
			: Reflect.get(window, PAGE_DATA_KEY);
	if (isPageData<T>(shared)) return shared;

	return signal(usePageContext<T>()).asReadonly();
};

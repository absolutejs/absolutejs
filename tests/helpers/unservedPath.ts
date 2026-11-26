import { LOADING_INDICATOR_PATH } from '../../src/core/loadingIndicator';

const NO_CONTENT = 204;
const NOT_FOUND = 404;

/** What a hand-rolled test server answers for a path it does not serve.
 *
 *  A 404 — except for the one path the navigation layer itself asks for.
 *  A soft navigation that outlasts 150ms fetches the `loading`
 *  convention from `/__absolute/loading`, and an app assembled by
 *  `prepare()` answers 204 when it ships none. These servers are
 *  assembled by hand, answered 404, and the browser logged it as a
 *  failed resource — so every test here that asserts a clean console
 *  failed whenever a navigation was slow, which on a shared CI runner is
 *  sometimes. It was the "intermittent 404" in `vue-navigation-browser`,
 *  unexplained until that test began recording the URL. */
export const unservedPath = (pathname: string) =>
	pathname === LOADING_INDICATOR_PATH
		? new Response(null, { status: NO_CONTENT })
		: new Response('not found', { status: NOT_FOUND });

/**
 * vue-router redirect bridge for SSR.
 *
 * vue-router doesn't expose Angular-style providers, but it doesn't need
 * them — after `await router.push(url); await router.isReady()`, the
 * router's `currentRoute.value.fullPath` reflects the final destination
 * after every guard, redirect rule, and `next('/foo')` call has run.
 *
 * If that final path differs from the URL the server received, a redirect
 * happened. The Vue page handler exposes a `setRedirect` callback in the
 * `setupApp` context so the user's setup hook can short-circuit the
 * render and emit a 302 instead of producing HTML for a route the user
 * never asked for.
 *
 * Usage:
 *
 *   import { applyVueRouterRedirect } from '@absolutejs/absolute/vue';
 *
 *   export const setupApp = async (app, { url, isServer, setRedirect }) => {
 *     const router = createRouter({ ... });
 *     app.use(router);
 *     if (isServer) await router.push(url);
 *     await router.isReady();
 *     if (isServer) applyVueRouterRedirect(router, url, setRedirect);
 *   };
 */

// Structural shape of the only fields we read from a vue-router instance.
// Avoids depending on `vue-router` types — the user installs vue-router
// themselves; the absolutejs package shouldn't pull it into every consumer's
// type-check just for one helper.
type VueRouterLike = {
	currentRoute: { value: { fullPath: string } };
};

const DEFAULT_REDIRECT_STATUS = 302;

const normalisePathname = (raw: string) => {
	try {
		const parsed = new URL(raw, 'http://placeholder.local/');

		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return raw;
	}
};

/**
 * Compare the requested URL against vue-router's current resolved path
 * after `router.push(url); await router.isReady()`. If different — a
 * guard redirected, a redirect rule fired, or the user manually
 * navigated inside `setupApp` — invoke `setRedirect` so the Vue page
 * handler emits an HTTP redirect instead of rendering.
 *
 * Status defaults to `302`. Pass a different status (e.g. `301` or `308`)
 * for permanent redirects.
 */
export const applyVueRouterRedirect = (
	router: VueRouterLike,
	requestedUrl: string,
	setRedirect: (location: string, status?: number) => void,
	status: number = DEFAULT_REDIRECT_STATUS
) => {
	const finalPath = router.currentRoute.value.fullPath;
	const requestedPath = normalisePathname(requestedUrl);
	if (finalPath === requestedPath) return;
	setRedirect(finalPath, status);
};

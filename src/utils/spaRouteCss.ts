/** SPA child-route CSS resolver.
 *
 *  Each Vue page that registers `export const routes = defineRoutes([...])`
 *  is the SSR entry for an SPA shell. Child routes are lazily imported
 *  (`component: () => import('./Dashboard.vue')...`) so Bun.build emits
 *  them as separate chunks with their own CSS bundles.
 *
 *  Without this resolver, the SSR head only inlines the parent page's
 *  own compiled CSS — when the browser lands on `/portal/dashboard`,
 *  Dashboard's markup paints unstyled until the lazy chunk loads. This
 *  module reads a side manifest the build writes alongside each SPA
 *  page (`<pagePath>.spa.json`), matches the request URL against the
 *  registered child routes, and returns the matched child's CSS so the
 *  page handler can inline it next to the parent's.
 *
 *  See `core/build.ts` for the build-time side-manifest emission and
 *  `vue/pageHandler.ts` for the call site. */
import { readFile } from 'node:fs/promises';

type SpaRouteEntry = {
	/** Vue-router-style path pattern from `defineRoutes` — supports
	 *  `:param` segments. We use a simple matcher (not vue-router's full
	 *  one) since SSR only needs to identify *which* component will
	 *  render, not extract param values. */
	path: string;
	/** Absolute disk path to the route component's sibling compiled
	 *  CSS, written by core/build.ts. Empty string means the route has
	 *  no styles to inline (e.g. a redirect or a component that doesn't
	 *  use `<style scoped>`). */
	cssPath: string;
};

const sideManifestCache = new Map<string, SpaRouteEntry[]>();

const readSideManifest = async (
	sideManifestPath: string
): Promise<SpaRouteEntry[]> => {
	const cached = sideManifestCache.get(sideManifestPath);
	if (cached !== undefined) return cached;
	try {
		const raw = await readFile(sideManifestPath, 'utf-8');
		const parsed = JSON.parse(raw);
		const routes: SpaRouteEntry[] = Array.isArray(parsed) ? parsed : [];
		sideManifestCache.set(sideManifestPath, routes);

		return routes;
	} catch {
		// No side manifest — page doesn't define SPA child routes, or
		// the build hasn't written it yet. Cache the miss.
		sideManifestCache.set(sideManifestPath, []);

		return [];
	}
};

/** Translate a vue-router-style path pattern into a RegExp that matches
 *  the same set of URLs. Supports `:param` (segment), `:param(\\d+)`
 *  (segment with custom regex), and trailing `*` wildcards. Anchored to
 *  `^…$` so partial matches don't sneak through. */
const compilePathToRegExp = (pattern: string): RegExp => {
	// Escape regex metachars, then unescape the colon/wildcard tokens we
	// re-introduce below.
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
	const withParams = escaped
		.replace(/:([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '[^/]+')
		.replace(/\\\*/g, '.*');

	return new RegExp(`^${withParams}$`);
};

const routeMatchers = new Map<string, RegExp>();

const matcherFor = (pattern: string): RegExp => {
	const cached = routeMatchers.get(pattern);
	if (cached !== undefined) return cached;
	const compiled = compilePathToRegExp(pattern);
	routeMatchers.set(pattern, compiled);

	return compiled;
};

/** Find the route whose path pattern matches the given URL pathname.
 *  Routes are tried in declaration order; the first match wins. */
const findMatchingRoute = (
	routes: SpaRouteEntry[],
	pathname: string
): SpaRouteEntry | null => {
	for (const route of routes) {
		if (matcherFor(route.path).test(pathname)) return route;
	}

	return null;
};

const childCssCache = new Map<string, string>();

const readChildCss = async (cssPath: string): Promise<string> => {
	if (!cssPath) return '';
	const cached = childCssCache.get(cssPath);
	if (cached !== undefined) return cached;
	try {
		const css = await readFile(cssPath, 'utf-8');
		childCssCache.set(cssPath, css);

		return css;
	} catch {
		childCssCache.set(cssPath, '');

		return '';
	}
};

/** Resolve the matched SPA child route's compiled CSS for a request.
 *  Returns the CSS text (possibly empty) so the page handler can
 *  inline it alongside the parent page's own sibling CSS. */
export const resolveSpaChildCss = async (
	siblingJsPath: string | undefined,
	requestUrl: string | undefined
): Promise<string> => {
	if (!siblingJsPath || !requestUrl) return '';
	const sideManifestPath = siblingJsPath.replace(/\.js$/, '.spa.json');
	if (sideManifestPath === siblingJsPath) return '';
	const routes = await readSideManifest(sideManifestPath);
	if (routes.length === 0) return '';
	let pathname: string;
	try {
		pathname = new URL(requestUrl).pathname;
	} catch {
		// `requestUrl` may be a bare path in tests — fall back to it as-is.
		pathname = requestUrl.split('?')[0] ?? requestUrl;
	}
	const matched = findMatchingRoute(routes, pathname);
	if (!matched) return '';

	return readChildCss(matched.cssPath);
};

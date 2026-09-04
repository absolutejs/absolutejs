import {
	Children,
	createElement,
	isValidElement,
	type ReactNode,
	useCallback,
	useMemo
} from 'react';
import {
	BrowserRouter,
	matchRoutes,
	type RouteObject,
	StaticRouter,
	useNavigate
} from 'react-router';
import {
	type NavigateOptions,
	type RouterNavigation,
	RouterNavigationContext
} from './navigationContext';

export type UniversalRouterProps = {
	/** The request URL to seed `<StaticRouter>` with on the server. Pages
	 *  typically forward `props.url` (auto-injected by handleReactPageRequest
	 *  from `request.url`). Ignored in the browser, where `<BrowserRouter>`
	 *  reads `window.location` directly. Defaults to '/'. */
	url?: string;
	children?: ReactNode;
};

type RouteLikeProps = {
	children?: ReactNode;
	index?: boolean;
	path?: string;
};

const readRouteProps = (props: unknown): RouteLikeProps => {
	if (typeof props !== 'object' || props === null) return {};
	const path = Reflect.get(props, 'path');
	const index = Reflect.get(props, 'index');
	const children = Reflect.get(props, 'children');

	return {
		children:
			isValidElement(children) || Array.isArray(children)
				? children
				: undefined,
		index: index === true ? true : undefined,
		path: typeof path === 'string' ? path : undefined
	};
};

/** Best-effort static view of the `<Route>` tree under the router, so
 *  `<Link>` can tell a shell route (client-side navigation) from a
 *  different page (real navigation). Walks inline JSX only — routes
 *  produced by an intermediate component are opaque and yield `[]`. */
const collectRoutes = (node: ReactNode): RouteObject[] =>
	Children.toArray(node).flatMap((child) => {
		if (!isValidElement(child)) return [];
		const { children, index, path } = readRouteProps(child.props);
		if (index === true) return [{ index: true, path }];
		if (path !== undefined) {
			return [{ children: collectRoutes(children), path }];
		}

		return collectRoutes(children);
	});

const toPathname = (href: string) => {
	if (typeof window === 'undefined') return href;

	try {
		return new URL(href, window.location.href).pathname;
	} catch {
		return href;
	}
};

type NavigationBridgeProps = {
	routes: RouteObject[];
	children?: ReactNode;
};

/** Publishes react-router's `navigate` (plus a route matcher) on
 *  `RouterNavigationContext` so `<Link>` — which deliberately never
 *  imports react-router — can navigate client-side inside the shell. */
const NavigationBridge = ({ routes, children }: NavigationBridgeProps) => {
	const routerNavigate = useNavigate();

	const navigate = useCallback(
		(href: string, options: NavigateOptions = {}) => {
			void routerNavigate(href, { replace: options.replace === true });
		},
		[routerNavigate]
	);

	const matches = useCallback(
		(href: string) => {
			if (routes.length === 0) return null;

			return matchRoutes(routes, toPathname(href)) !== null;
		},
		[routes]
	);

	const value = useMemo<RouterNavigation>(
		() => ({ matches, navigate }),
		[matches, navigate]
	);

	return createElement(RouterNavigationContext.Provider, { value }, children);
};

/** SSR-safe wrapper around react-router that picks `<StaticRouter>` on the
 *  server and `<BrowserRouter>` in the browser. Without it, every SPA page
 *  has to write its own `typeof window === 'undefined'` branch and import
 *  both routers — boilerplate that's the same in every page.
 *
 *  Usage:
 *
 *    import { Link, UniversalRouter } from '@absolutejs/absolute/react/router';
 *
 *    export const MySpa = ({ url }: { url?: string }) => (
 *      <html>
 *        <Head />
 *        <body>
 *          <UniversalRouter url={url}>
 *            <Link href="/foo">Foo</Link>
 *            <Routes>
 *              <Route path="/foo" element={<Foo />} />
 *            </Routes>
 *          </UniversalRouter>
 *        </body>
 *      </html>
 *    );
 *
 *  `<Link>`s rendered inside navigate client-side when their `href`
 *  matches one of the `<Route>`s above (see `navigationContext.ts`).
 *
 *  This component lives on its own `@absolutejs/absolute/react/router`
 *  subpath rather than the main `@absolutejs/absolute/react` barrel so the
 *  static `import 'react-router'` below only loads for consumers who
 *  actually use the router — importing `Head`/`Image`/`Island` from
 *  `@absolutejs/absolute/react` does not pull react-router into the bundle,
 *  so projects that don't route aren't forced to install it.
 *
 *  `<BrowserRouter>` reads `window.history` at construction, so it throws
 *  if instantiated on the server. The `typeof window` check has to live at
 *  render time (not import time) because the module is loaded in both
 *  environments. */
export const UniversalRouter = ({ url, children }: UniversalRouterProps) => {
	const routes = useMemo(() => collectRoutes(children), [children]);
	const bridged = createElement(NavigationBridge, { routes }, children);

	if (typeof window === 'undefined') {
		return createElement(StaticRouter, { location: url ?? '/' }, bridged);
	}

	return createElement(BrowserRouter, null, bridged);
};

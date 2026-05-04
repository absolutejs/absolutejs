import { createElement, type ReactNode } from 'react';

export type UniversalRouterProps = {
	/** The request URL to seed `<StaticRouter>` with on the server. Pages
	 *  typically forward `props.url` (auto-injected by handleReactPageRequest
	 *  from `request.url`). Ignored in the browser, where `<BrowserRouter>`
	 *  reads `window.location` directly. Defaults to '/'. */
	url?: string;
	children?: ReactNode;
};

/** SSR-safe wrapper around react-router that picks `<StaticRouter>` on the
 *  server and `<BrowserRouter>` in the browser. Without it, every SPA page
 *  has to write its own `typeof window === 'undefined'` branch and import
 *  both routers — boilerplate that's the same in every page.
 *
 *  Usage:
 *
 *    export const MySpa = ({ url }: { url?: string }) => (
 *      <html>
 *        <Head />
 *        <body>
 *          <UniversalRouter url={url}>
 *            <Routes>
 *              <Route path="/foo" element={<Foo />} />
 *            </Routes>
 *          </UniversalRouter>
 *        </body>
 *      </html>
 *    );
 *
 *  Implementation note: `react-router` is required lazily via
 *  `createRequire` so consumers who don't use `UniversalRouter` aren't
 *  forced to install react-router just to import other things from
 *  `@absolutejs/absolute/react` (the previous eager static import made
 *  `dist/react/index.js` carry a `import "react-router"` that broke
 *  every consumer's bundle who hadn't installed it). Bun resolves the
 *  CJS interop synchronously, so render is still purely synchronous.
 *
 *  `<BrowserRouter>` reads `window.history` at construction, so it
 *  throws if instantiated on the server. The `typeof window` check has
 *  to live at render time (not import time) because the module is
 *  loaded in both environments. */

type ReactRouterModule = {
	BrowserRouter: (...args: unknown[]) => unknown;
	StaticRouter: (...args: unknown[]) => unknown;
};

let cachedReactRouter: ReactRouterModule | null = null;

const loadReactRouter = (): ReactRouterModule => {
	if (cachedReactRouter) return cachedReactRouter;

	// Hide the bare specifier behind a Function-constructor so static
	// bundlers can't analyze it — they only see a `Function(string)`
	// call, not an `import "react-router"`. Resolution happens at
	// render time and only on the first call to `UniversalRouter`,
	// so consumers who never use it never pay the install cost.
	// `require` is available in Bun's CJS-interop context (server)
	// and in any bundle output that emitted a CJS-compatible runtime.
	try {
		const dynamicRequire = new Function(
			'spec',
			'return require(spec)'
		) as (spec: string) => ReactRouterModule;
		cachedReactRouter = dynamicRequire('react-router');

		return cachedReactRouter;
	} catch {
		const fromWindow = (
			globalThis as { ReactRouterDOM?: ReactRouterModule }
		).ReactRouterDOM;
		if (fromWindow) {
			cachedReactRouter = fromWindow;

			return cachedReactRouter;
		}
		throw new Error(
			'[UniversalRouter] react-router is not installed. Install it with `bun add react-router` to use UniversalRouter.'
		);
	}
};

export const UniversalRouter = ({ url, children }: UniversalRouterProps) => {
	const { BrowserRouter, StaticRouter } = loadReactRouter();
	if (typeof window === 'undefined') {
		return createElement(
			StaticRouter,
			{ location: url ?? '/' },
			children
		);
	}

	return createElement(BrowserRouter, null, children);
};

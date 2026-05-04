import { createElement, type ReactNode } from 'react';
import { BrowserRouter, StaticRouter } from 'react-router';

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
 *  Implementation note: `<BrowserRouter>` reads `window.history` at
 *  construction, so it throws if instantiated on the server. The
 *  `typeof window` check has to live at render time (not import time)
 *  because the module is loaded in both environments — only the
 *  unselected branch's JSX is what the check skips. */
export const UniversalRouter = ({ url, children }: UniversalRouterProps) => {
	if (typeof window === 'undefined') {
		return createElement(
			StaticRouter,
			{ location: url ?? '/' },
			children
		);
	}

	return createElement(BrowserRouter, null, children);
};

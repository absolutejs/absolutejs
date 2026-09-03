import { createContext } from 'react';

export type NavigateOptions = {
	replace?: boolean;
};

/** Client-side navigation bridge published by `<UniversalRouter>` so a
 *  `<Link>` rendered inside an SPA shell can push history through
 *  react-router instead of triggering a full document load.
 *
 *  Lives in its own module with no `react-router` import: `<Link>` reads
 *  the context and stays usable (as a prefetching `<a>`) in MPA projects
 *  that never install react-router. Only `UniversalRouter` — already on
 *  the `react/router` subpath that owns the react-router dependency —
 *  provides a value. */
export type RouterNavigation = {
	/** `true` / `false` when the shell's `<Route>` tree could be inspected
	 *  and `href` does / doesn't match one of its routes; `null` when the
	 *  routes are opaque (rendered by a component, not inline JSX) and the
	 *  shell should be trusted to handle the path. */
	matches: (href: string) => boolean | null;
	navigate: (href: string, options?: NavigateOptions) => void;
};

export const RouterNavigationContext = createContext<RouterNavigation | null>(
	null
);

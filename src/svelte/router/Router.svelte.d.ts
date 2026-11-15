import { SvelteComponent, type Snippet } from 'svelte';
import type {
	LazyRouteLoader,
	RouteGuard,
	RouterMode
} from '../../../types/svelteRouter';
import type { compilePattern } from './matchPath';

/* The registry a Router gives its Routes through context, declared in the
 * component's module script. Route.svelte imports it from here, so this
 * file declares it too. */
type RouteEntry = {
	pattern: ReturnType<typeof compilePattern>;
	fullPath: string;
	registrationOrder: number;
	getGuard: () => RouteGuard | undefined;
	getLoader: () => LazyRouteLoader | undefined;
};

type ActiveMatch = {
	id: string;
	params: Record<string, string | undefined>;
};

export type RouterRegistry = {
	basepath: string;
	mode: RouterMode;
	register: (id: string, entry: RouteEntry) => void;
	deregister: (id: string) => void;
	nextRouteId: () => string;
	getActiveMatch: () => ActiveMatch | null;
};

type RouterProps = {
	url?: string;
	basepath?: string;
	mode?: RouterMode;
	/** Runs before every navigation onto this router's routes (the
	 *  outermost router: every navigation), and during the server render,
	 *  where a redirect becomes a 302. */
	guard?: RouteGuard;
	children?: Snippet;
};

declare const __propDef: { props: RouterProps };
type Props = typeof __propDef.props;

class Router extends SvelteComponent<Props> {}

export { Router as default };

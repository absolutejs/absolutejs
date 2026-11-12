import { SvelteComponent, type Snippet } from 'svelte';
import type { RouteGuard, RouterMode } from '../../../types/svelteRouter';

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

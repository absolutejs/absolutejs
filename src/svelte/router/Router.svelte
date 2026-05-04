<script lang="ts" module>
	type RouteEntry = {
		// reactive — read by the winner-resolver
		pattern: ReturnType<typeof import('./matchPath').compilePattern>;
		// stable — assigned at registration time, used as tiebreaker
		registrationOrder: number;
	};

	type ActiveMatch = {
		id: string;
		params: Record<string, string | undefined>;
	};

	export type RouterRegistry = {
		basepath: string;
		mode: import('../../../types/svelteRouter').RouterMode;
		register: (id: string, entry: RouteEntry) => void;
		deregister: (id: string) => void;
		nextRouteId: () => string;
		// Returns the currently-winning Route's id and matched params, or null
		// if no Route matches. Routes call this to decide whether to render.
		// Reads $state internally, so callers using it inside $derived/$effect
		// auto-subscribe to URL + registration changes.
		getActiveMatch: () => ActiveMatch | null;
	};
</script>

<script lang="ts">
	import { getContext, onMount, setContext, type Snippet } from 'svelte';
	import type { RouterMode } from '../../../types/svelteRouter';
	import { setRouterMode } from './goto';
	import { hashPathnameOf } from './hashMode';
	import { joinBasepath, matchPattern } from './matchPath';
	import { page, seedPage, setPage } from './page.svelte';

	const ROUTER_CONTEXT_KEY = Symbol.for('absolutejs.svelte-router');

	type RouterProps = {
		/** SSR URL passthrough. On the server, the page handler forwards
		 *  `request.url` here. On the client, this prop is omitted and the
		 *  router reads `window.location` instead. */
		url?: string;
		/** Optional URL prefix the router operates under. Stacks with
		 *  parent `<Router basepath>` blocks for nested routers. */
		basepath?: string;
		/** `'history'` (default, clean URLs) or `'hash'` (`/#/path`,
		 *  for static deploys). */
		mode?: RouterMode;
		children?: Snippet;
	};

	let {
		url,
		basepath = '',
		mode = 'history',
		children
	}: RouterProps = $props();

	const parent = getContext<RouterRegistry | undefined>(ROUTER_CONTEXT_KEY);
	const stackedBasepath = parent
		? joinBasepath(parent.basepath, basepath)
		: basepath === ''
			? ''
			: basepath.startsWith('/')
				? basepath
				: `/${basepath}`;
	const stackedMode: RouterMode = parent?.mode ?? mode;
	const isOutermost = parent === undefined;

	// Specificity ranking across siblings: each <Route> registers with
	// its compiled pattern + a stable mount-order index. The winner is
	// computed lazily from the current URL — highest score wins; ties
	// break by earlier registration order. The winning Route then renders
	// its own content at ITS location in the markup (so a Route nested
	// inside a layout `<section>` renders inside that section, not at the
	// Router's root).
	const routes = $state(new Map<string, RouteEntry>());
	let routeCounter = 0;

	const computeWinner = (): ActiveMatch | null => {
		let bestId: string | null = null;
		let bestParams: Record<string, string | undefined> | null = null;
		let bestScore = -Infinity;
		let bestOrder = Infinity;

		for (const [id, entry] of routes) {
			const match = matchPattern(entry.pattern, page.url.pathname);
			if (!match.matched) continue;

			if (
				entry.pattern.score > bestScore ||
				(entry.pattern.score === bestScore &&
					entry.registrationOrder < bestOrder)
			) {
				bestScore = entry.pattern.score;
				bestOrder = entry.registrationOrder;
				bestId = id;
				bestParams = match.params as Record<string, string | undefined>;
			}
		}

		return bestId && bestParams ? { id: bestId, params: bestParams } : null;
	};

	// Recompute on every call rather than caching via $derived. SSR
	// renders Routes in declaration order; each Route's template invokes
	// `getActiveMatch()` immediately after registering itself, before its
	// siblings have registered. A cached value would freeze on whichever
	// Route triggered the computation first, so later-registered (more
	// specific) Routes would lose. Calling `computeWinner()` afresh on
	// every read sees the full registry by the time all Routes have
	// rendered. Each call is O(N) over N routes; for typical pages
	// (N < 20) the recomputation is negligible. Reactivity still works:
	// each Route wraps the call in its own `$derived`, which tracks the
	// `$state(routes)` and `page.url` reads inside `computeWinner`.
	const registry: RouterRegistry = {
		basepath: stackedBasepath,
		deregister: (id) => {
			routes.delete(id);
		},
		getActiveMatch: () => computeWinner(),
		mode: stackedMode,
		nextRouteId: () => `r${routeCounter++}`,
		register: (id, entry) => {
			routes.set(id, entry);
		}
	};

	setContext<RouterRegistry>(ROUTER_CONTEXT_KEY, registry);

	if (isOutermost) {
		setRouterMode(stackedMode);

		const baseUrl =
			typeof window !== 'undefined' ? window.location.href : (url ?? '/');
		const fullUrl =
			typeof window !== 'undefined'
				? new URL(baseUrl)
				: new URL(baseUrl, 'http://localhost/');

		const routablePathname =
			stackedMode === 'hash' ? hashPathnameOf(fullUrl) : fullUrl.pathname;
		const initial = new URL(fullUrl.href);
		initial.pathname = routablePathname;
		seedPage(initial);
	}

	onMount(() => {
		if (!isOutermost) return;

		const onPopState = (event: PopStateEvent) => {
			const next = new URL(window.location.href);
			const routable =
				stackedMode === 'hash' ? hashPathnameOf(next) : next.pathname;
			const synthetic = new URL(next.href);
			synthetic.pathname = routable;
			setPage({
				params: {},
				state: event.state ?? null,
				url: synthetic
			});
		};

		const onHashChange = () => {
			const next = new URL(window.location.href);
			const synthetic = new URL(next.href);
			synthetic.pathname = hashPathnameOf(next);
			setPage({
				params: {},
				state: window.history.state ?? null,
				url: synthetic
			});
		};

		window.addEventListener('popstate', onPopState);
		if (stackedMode === 'hash') {
			window.addEventListener('hashchange', onHashChange);
		}

		return () => {
			window.removeEventListener('popstate', onPopState);
			if (stackedMode === 'hash') {
				window.removeEventListener('hashchange', onHashChange);
			}
		};
	});
</script>

{@render children?.()}

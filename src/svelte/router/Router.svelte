<script lang="ts" module>
	type RouteEntry = {
		// reactive — read by the winner-resolver
		pattern: ReturnType<typeof import('./matchPath').compilePattern>;
		// basepath-joined path pattern, the lazy-route cache key
		fullPath: string;
		// stable — assigned at registration time, used as tiebreaker
		registrationOrder: number;
		// read on demand so a changed prop is always seen
		getGuard: () =>
			| import('../../../types/svelteRouter').RouteGuard
			| undefined;
		getLoader: () =>
			| import('../../../types/svelteRouter').LazyRouteLoader
			| undefined;
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
	import type {
		RouteGuard,
		RouterMode,
		SvelteRouterSsrState
	} from '../../../types/svelteRouter';
	import { type GuardEntry, runGuardChain } from './guards';
	import { buildHashHref, hashPathnameOf } from './hashMode';
	import { lazyCacheKey, loadLazy } from './lazy';
	import { joinBasepath, matchPattern } from './matchPath';
	import {
		enterInitialRoute,
		handleTraversal,
		registerRouter,
		restoreInitialScroll,
		setRouterMode
	} from './navigation';
	import { page, seedPage } from './page.svelte';
	import { activateScrollRestoration, stampInitialEntry } from './scroll';

	const ROUTER_CONTEXT_KEY = Symbol.for('absolutejs.svelte-router');
	const ROUTER_SSR_KEY = Symbol.for('absolutejs.svelte-router.ssr');

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
		/** Runs before every navigation onto this router's routes (the
		 *  outermost router: every navigation), before the matched
		 *  `<Route guard>`. Runs during the server render too, where a
		 *  redirect becomes a 302. Return `false` to cancel, a URL or
		 *  `redirect(...)` to redirect, nothing to allow. */
		guard?: RouteGuard;
		children?: Snippet;
	};

	let {
		url,
		basepath = '',
		mode = 'history',
		guard,
		children
	}: RouterProps = $props();

	const parent = getContext<RouterRegistry | undefined>(ROUTER_CONTEXT_KEY);
	const ssr = getContext<SvelteRouterSsrState | undefined>(ROUTER_SSR_KEY);
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

	const computeWinnerFor = (pathname: string): ActiveMatch | null => {
		let bestId: string | null = null;
		let bestParams: Record<string, string | undefined> | null = null;
		let bestScore = -Infinity;
		let bestOrder = Infinity;

		for (const [id, entry] of routes) {
			const match = matchPattern(entry.pattern, pathname);
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
		getActiveMatch: () => computeWinnerFor(page.url.pathname),
		mode: stackedMode,
		nextRouteId: () => `r${routeCounter++}`,
		register: (id, entry) => {
			routes.set(id, entry);
		}
	};

	setContext<RouterRegistry>(ROUTER_CONTEXT_KEY, registry);

	// Guards for a navigation to `target`: this router's own guard (the
	// outermost one always; a nested one only when one of its routes
	// matches), then the matched route's guard.
	const guardsFor = (target: URL) => {
		const winner = computeWinnerFor(target.pathname);
		const entries: GuardEntry[] = [];
		const routerGuard = guard;
		if (routerGuard && (isOutermost || winner)) {
			entries.push({ guard: routerGuard, params: winner?.params ?? {} });
		}
		const routeGuard = winner
			? routes.get(winner.id)?.getGuard()
			: undefined;
		if (winner && routeGuard) {
			entries.push({ guard: routeGuard, params: winner.params });
		}

		return entries;
	};

	const matches = (target: URL) => computeWinnerFor(target.pathname) !== null;

	const preload = (target: URL) => {
		const winner = computeWinnerFor(target.pathname);
		const entry = winner ? routes.get(winner.id) : undefined;
		const loader = entry?.getLoader();
		if (!entry || !loader) return;
		loadLazy(lazyCacheKey(entry.fullPath, loader), loader).catch(() => {
			// A failed prefetch is retried (and reported) by the Route
			// itself if the user actually navigates there.
		});
	};

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

	// Server render: once this pass has registered every Route, run this
	// router's guards for the request URL. The page handler awaits them
	// before rendering again; a redirect becomes a 302. The URL is captured
	// now — `page` is shared module state and other requests may render
	// before the guards run.
	if (ssr) {
		const renderUrl = new URL(page.url.href);
		const requestUrl = new URL(url ?? '/', 'http://localhost/');
		const guardKey = `${stackedBasepath}\u0000${renderUrl.href}`;
		ssr.afterRender(async () => {
			if (ssr.outcome() !== undefined) return;
			if (ssr.settledGuards.has(guardKey)) return;
			ssr.settledGuards.add(guardKey);
			const decision = await runGuardChain(guardsFor(renderUrl), {
				from: null,
				request: ssr.request,
				to: renderUrl,
				type: 'enter'
			});
			if (decision.kind === 'cancel') ssr.setOutcome({ kind: 'cancel' });
			if (decision.kind !== 'redirect') return;
			const target = new URL(decision.location, renderUrl);
			const location =
				stackedMode === 'hash'
					? `${requestUrl.pathname}${requestUrl.search}${buildHashHref(target.pathname + target.search)}`
					: target.origin === renderUrl.origin
						? `${target.pathname}${target.search}${target.hash}`
						: target.href;
			ssr.setOutcome({ kind: 'redirect', location });
		});
	}

	onMount(() => {
		const unregister = registerRouter({ guardsFor, matches, preload });
		if (!isOutermost) return unregister;

		const initialEntry = stampInitialEntry();
		const deactivateScroll = activateScrollRestoration();
		const navigationEntry = performance.getEntriesByType('navigation')[0];
		const navigationKind =
			navigationEntry && 'type' in navigationEntry
				? navigationEntry.type
				: undefined;
		if (
			initialEntry.scroll &&
			(navigationKind === 'reload' || navigationKind === 'back_forward')
		) {
			void restoreInitialScroll(initialEntry.scroll);
		}
		if (stackedMode === 'hash') void enterInitialRoute(page.url);

		const routableUrl = () => {
			const next = new URL(window.location.href);
			const synthetic = new URL(next.href);
			if (stackedMode === 'hash')
				synthetic.pathname = hashPathnameOf(next);

			return synthetic;
		};

		let lastTraversalHref = '';
		const onPopState = (event: PopStateEvent) => {
			lastTraversalHref = window.location.href;
			void handleTraversal(event.state, routableUrl());
		};

		// Browsers fire `popstate` for hash changes too; `hashchange` only
		// catches the rare engine that doesn't, so skip URLs already handled.
		const onHashChange = () => {
			if (window.location.href === lastTraversalHref) return;
			const next = routableUrl();
			if (next.href === page.url.href) return;
			lastTraversalHref = window.location.href;
			void handleTraversal(window.history.state, next);
		};

		window.addEventListener('popstate', onPopState);
		if (stackedMode === 'hash') {
			window.addEventListener('hashchange', onHashChange);
		}

		return () => {
			unregister();
			deactivateScroll();
			window.removeEventListener('popstate', onPopState);
			if (stackedMode === 'hash') {
				window.removeEventListener('hashchange', onHashChange);
			}
		};
	});
</script>

{@render children?.()}

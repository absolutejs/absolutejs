<script lang="ts" generics="Path extends string">
	import { getContext, onDestroy, type Snippet } from 'svelte';
	import type {
		ExtractRouteParams,
		LazyRouteLoader,
		RouteGuard,
		SvelteRouterSsrState
	} from '../../../types/svelteRouter';
	import type { RouterRegistry } from './Router.svelte';
	import { forgetLazy, lazyCacheKey, loadLazy, peekLazy } from './lazy';
	import type { LazyComponent } from './lazyModule';
	import { compilePattern, joinBasepath } from './matchPath';

	const ROUTER_CONTEXT_KEY = Symbol.for('absolutejs.svelte-router');
	const ROUTER_SSR_KEY = Symbol.for('absolutejs.svelte-router.ssr');

	type RouteProps = {
		path: Path;
		/** Eager route: the snippet to render while the route is active. */
		content?: Snippet<[ExtractRouteParams<Path>]>;
		/** Lazy route: loads the component the first time the route is
		 *  needed — `() => import('./Page.svelte')`. The build splits it
		 *  into its own chunk; the server awaits it so the HTML is complete
		 *  and hydration matches. The component receives the route params
		 *  (and `props`) as props. */
		loader?: LazyRouteLoader;
		/** Extra props for a lazy route's component. */
		props?: Record<string, unknown>;
		/** Rendered while a lazy route's component loads in the browser. */
		pending?: Snippet;
		/** Rendered when a lazy route's loader rejects. `retry` calls the
		 *  loader again. */
		error?: Snippet<[unknown, () => void]>;
		/** Runs before navigating onto this route, after the router's
		 *  guards. Runs during the server render too (a redirect becomes a
		 *  302). Return `false` to cancel, a URL or `redirect(...)` to
		 *  redirect, nothing to allow. */
		guard?: RouteGuard;
	};

	let {
		path,
		content,
		loader,
		props: extraProps,
		pending,
		error,
		guard
	}: RouteProps = $props();

	const registry = getContext<RouterRegistry | undefined>(ROUTER_CONTEXT_KEY);
	if (!registry) {
		throw new Error(
			'<Route> must be a descendant of <Router>. ' +
				'Wrap your routes in `<Router url={...}>` (server) or `<Router>` (client).'
		);
	}
	const ssr = getContext<SvelteRouterSsrState | undefined>(ROUTER_SSR_KEY);

	const id = registry.nextRouteId();
	const registrationOrder = Number(id.slice(1));
	const fullPath = $derived(joinBasepath(registry.basepath, path));

	const createEntry = () => ({
		fullPath: joinBasepath(registry.basepath, path),
		getGuard: () => guard,
		getLoader: () => loader,
		pattern: compilePattern(joinBasepath(registry.basepath, path)),
		registrationOrder
	});

	// Register synchronously at script-body time so SSR (which doesn't
	// run $effect) sees the registration before the template runs.
	registry.register(id, createEntry());

	$effect(() => {
		registry.register(id, createEntry());
	});

	// The server render runs onDestroy as soon as the HTML is produced, but
	// the router's guards run after that (between render passes) and need
	// the full route table — so only the browser deregisters.
	onDestroy(() => {
		if (typeof window !== 'undefined') registry.deregister(id);
	});

	// The Router computes the active match across all registered Routes
	// (specificity-ranked). Each Route checks if it's the winner and
	// renders its own content at its own location in the markup. That
	// way `<Route>` nested inside a layout `<section>` renders inside
	// that section instead of getting hoisted to the Router's root.
	const match = $derived(registry.getActiveMatch());
	const isActive = $derived(match?.id === id);

	// ---- Lazy routes ---------------------------------------------------
	//
	// Browser: the component comes from the lazy cache — loaded on an
	// earlier visit, by a <Link> prefetch, or (first hydration) by the
	// hydration entry, which loads the modules the server rendered before
	// it hydrates. Otherwise the effect below loads it while `pending`
	// renders.
	//
	// Server: the first render pass registers the load with the page
	// handler, which awaits it and renders again with the component
	// resolved, so the HTML holds the real component.
	const cacheKey = $derived(loader ? lazyCacheKey(fullPath, loader) : '');
	// Read synchronously at creation so the first (hydrating) render
	// already has the component when it is available.
	const peekInitialComponent = () =>
		!ssr && loader
			? peekLazy(lazyCacheKey(fullPath, loader), fullPath)
			: undefined;
	let loadedComponent = $state<LazyComponent | undefined>(
		peekInitialComponent()
	);
	let loadFailure = $state<{ error: unknown } | undefined>(undefined);

	const serverLazy = (active: boolean) => {
		if (!ssr || !loader || !active) return undefined;
		const resolved = ssr.resolved.get(fullPath);
		if (!resolved) ssr.load(fullPath, loader);
		// No `error` snippet: fail the render like any other SSR error.
		if (resolved && 'error' in resolved && !error) throw resolved.error;

		return resolved;
	};

	const serverResolved = $derived(serverLazy(isActive));
	const Loaded = $derived(
		ssr
			? serverResolved && 'component' in serverResolved
				? serverResolved.component
				: undefined
			: loadedComponent
	);
	const failure = $derived(
		ssr
			? serverResolved && 'error' in serverResolved
				? { error: serverResolved.error }
				: undefined
			: loadFailure
	);

	const reportLoadFailure = (reason: unknown) => {
		loadFailure = { error: reason };
		// No `error` snippet: surface it like any uncaught error (the dev
		// overlay shows it) instead of failing silently.
		if (!error) {
			queueMicrotask(() => {
				throw reason;
			});
		}
	};

	$effect(() => {
		if (!loader || !isActive || loadFailure) return;
		const key = cacheKey;
		const cached = peekLazy(key, fullPath);
		if (cached) {
			if (loadedComponent !== cached) loadedComponent = cached;

			return;
		}
		if (loadedComponent) loadedComponent = undefined;
		let live = true;
		loadLazy(key, loader).then(
			(component) => {
				if (live) loadedComponent = component;
			},
			(reason: unknown) => {
				if (live) reportLoadFailure(reason);
			}
		);

		return () => {
			live = false;
		};
	});

	const retry = () => {
		forgetLazy(cacheKey);
		loadFailure = undefined;
		loadedComponent = undefined;
	};
</script>

{#if isActive && match}
	{#if loader}
		{#if Loaded}
			<Loaded {...extraProps ?? {}} {...match.params} />
		{:else if failure}
			{@render error?.(failure.error, retry)}
		{:else if pending}
			{@render pending()}
		{/if}
	{:else if content}
		{@render content(match.params as ExtractRouteParams<Path>)}
	{/if}
{/if}

<script lang="ts">
	/* A route's page inside a wrapper (a frame, a guard), loaded the first
	 * time it is shown. The build writes it (svelte/lowerRoutePages.ts) in
	 * place of `<Page ... />` within a route's `content` snippet; the
	 * wrapper stays as written and renders at once.
	 *
	 * It shares the router's lazy route machinery under its own `id`: the
	 * server awaits the load and renders the page in full, the browser
	 * loads it before hydrating, and a page loaded once renders at once
	 * after. */
	import { getContext } from 'svelte';
	import type {
		LazyRouteLoader,
		SvelteRouterSsrState
	} from '../../../types/svelteRouter';
	import { lazyCacheKey, loadLazy, peekLazy } from './lazy';
	import type { LazyComponent } from './lazyModule';

	const ROUTER_SSR_KEY = Symbol.for('absolutejs.svelte-router.ssr');

	type LazyPageProps = {
		/** Stable per page and file, written by the build. */
		id: string;
		loader: LazyRouteLoader;
		props?: Record<string, unknown>;
	};

	let { id, loader, props: pageProps }: LazyPageProps = $props();

	const ssr = getContext<SvelteRouterSsrState | undefined>(ROUTER_SSR_KEY);
	const key = $derived(lazyCacheKey(id, loader));
	const peekInitial = () =>
		ssr ? undefined : peekLazy(lazyCacheKey(id, loader), id);
	let loaded = $state<LazyComponent | undefined>(peekInitial());

	const serverLoad = () => {
		if (!ssr) return undefined;
		const resolved = ssr.resolved.get(id);
		if (!resolved) ssr.load(id, loader);
		if (resolved && 'error' in resolved) throw resolved.error;

		return resolved && 'component' in resolved
			? resolved.component
			: undefined;
	};
	const serverComponent = $derived(serverLoad());
	const Loaded = $derived(ssr ? serverComponent : loaded);

	$effect(() => {
		if (ssr) return;
		const cacheKey = key;
		const cached = peekLazy(cacheKey, id);
		if (cached) {
			if (loaded !== cached) loaded = cached;

			return;
		}
		let live = true;
		loadLazy(cacheKey, loader).then(
			(component) => {
				if (live) loaded = component;
			},
			(reason: unknown) => {
				// Surfaced like any uncaught error (the dev overlay shows it).
				queueMicrotask(() => {
					throw reason;
				});
			}
		);

		return () => {
			live = false;
		};
	});
</script>

{#if Loaded}
	<Loaded {...pageProps ?? {}} />
{/if}

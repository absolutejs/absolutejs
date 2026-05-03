<script lang="ts" generics="Path extends string">
	import { getContext, onDestroy, type Snippet } from 'svelte';
	import type { ExtractRouteParams } from '../../../types/svelteRouter';
	import type { RouterRegistry } from './Router.svelte';
	import { compilePattern, joinBasepath } from './matchPath';

	const ROUTER_CONTEXT_KEY = Symbol.for('absolutejs.svelte-router');

	type RouteProps = {
		path: Path;
		content: Snippet<[ExtractRouteParams<Path>]>;
	};

	let { path, content }: RouteProps = $props();

	const registry = getContext<RouterRegistry | undefined>(ROUTER_CONTEXT_KEY);
	if (!registry) {
		throw new Error(
			'<Route> must be a descendant of <Router>. ' +
				'Wrap your routes in `<Router url={...}>` (server) or `<Router>` (client).'
		);
	}

	const id = registry.nextRouteId();
	const registrationOrder = Number(id.slice(1));

	// Register synchronously at script-body time so SSR (which doesn't
	// run $effect) sees the registration before the template runs.
	registry.register(id, {
		pattern: compilePattern(joinBasepath(registry.basepath, path)),
		registrationOrder
	});

	$effect(() => {
		registry.register(id, {
			pattern: compilePattern(joinBasepath(registry.basepath, path)),
			registrationOrder
		});
	});

	onDestroy(() => registry.deregister(id));

	// The Router computes the active match across all registered Routes
	// (specificity-ranked). Each Route checks if it's the winner and
	// renders its own content at its own location in the markup. That
	// way `<Route>` nested inside a layout `<section>` renders inside
	// that section instead of getting hoisted to the Router's root.
	const match = $derived(registry.getActiveMatch());
	const isActive = $derived(match?.id === id);
</script>

{#if isActive && match}
	{@render content(match.params as ExtractRouteParams<Path>)}
{/if}

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
	// run $effect) sees the registration. The Router itself owns
	// rendering of the winning route's content — Route emits no DOM and
	// no hydration markers, so a page with N <Route>s produces ONE
	// `{#if}` block in the rendered HTML, not N.
	const initialCompiled = compilePattern(
		joinBasepath(registry.basepath, path)
	);
	registry.register(id, {
		content: content as Snippet<[Record<string, string | undefined>]>,
		pattern: initialCompiled,
		registrationOrder
	});

	$effect(() => {
		registry.register(id, {
			content: content as Snippet<[Record<string, string | undefined>]>,
			pattern: compilePattern(joinBasepath(registry.basepath, path)),
			registrationOrder
		});
	});

	onDestroy(() => registry.deregister(id));
</script>

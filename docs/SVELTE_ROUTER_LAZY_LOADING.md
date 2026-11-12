# Svelte Router — Lazy Loading

Status: **Shipped.** A `<Route>` can take a component **loader** instead of a `content` snippet. The build splits the component into its own chunk, the browser loads it when the route is first needed (or prefetched), and the server awaits it so the HTML is complete and hydration matches.

## API

```svelte
<script lang="ts">
	import Router from '@absolutejs/absolute/svelte/router/Router.svelte';
	import Route from '@absolutejs/absolute/svelte/router/Route.svelte';
	import Link from '@absolutejs/absolute/svelte/router/Link.svelte';

	let { url }: { url?: string } = $props();
</script>

<Router {url}>
	<Link to="/app/editor/7">Open the editor</Link>

	<!-- Eager (unchanged) -->
	<Route path="/app">
		{#snippet content()}<Home />{/snippet}
	</Route>

	<!-- Lazy -->
	<Route
		path="/app/editor/:id"
		loader={() => import('./Editor.svelte')}
		props={{ readOnly: false }}
	>
		{#snippet pending()}<p>Loading the editor…</p>{/snippet}
		{#snippet error(reason, retry)}
			<p>The editor failed to load.</p>
			<button onclick={retry}>Try again</button>
		{/snippet}
	</Route>
</Router>
```

| Prop | |
| --- | --- |
| `loader` | `() => Promise<module \| Component>` — `() => import('./X.svelte')` works as is; a loader that already unwraps `.default` works too |
| `props` | extra props for the component; the route params are passed as props as well (`Editor` above gets `id`) |
| `pending` | snippet shown while a client-side navigation waits for the chunk |
| `error` | snippet `(reason, retry)` shown when the loader rejects; without it the error is rethrown (the dev overlay shows it, and on the server the page fails like any SSR error) |

`content` and `loader` are alternatives: the published `Route.svelte.d.ts` types them as a union, and a lazy route's `props` are checked against the component's props minus the route params.

## How it works

### Build

The Svelte compiler collects `import('./X.svelte')` specifiers alongside static imports, compiles those children, and the client bundle (code splitting is on) puts each in its own chunk. Two small additions make hydration possible:

- every compiled **server** module exports `__ABSOLUTE_SVELTE_SOURCE__` (its project-relative source path), also stamped on the component function;
- every compiled **client** module that imports a `.svelte` file dynamically registers `source → () => import(chunk)` in a `globalThis` registry (`Symbol.for('absolutejs.svelte.lazy-modules')`).

### Server render

Svelte's server render is synchronous, so the page handler renders in passes (at most 5). In the first pass an active lazy route starts its loader; the handler awaits it and renders again with the component resolved, so the HTML holds the real component — no pending state, no flash. One extra pass per nesting level of lazy routes; a page without lazy routes renders once, as before.

The handler then writes `window.__ABS_SVELTE_LAZY_ROUTES__ = { "<route pattern>": "<source>" }` into the bootstrap script.

### Hydration

Before it hydrates, the page's hydration entry loads the modules named in `__ABS_SVELTE_LAZY_ROUTES__` through the registry, and the lazy `<Route>` finds its component synchronously on the first client render. Hydration therefore adopts the server's DOM: no pending flash and no mismatch. (A loader that resolves to something without the source stamp still works; the route then re-renders once its chunk arrives.)

### Browser cache and prefetch

Components are cached by route pattern plus the loader's source text, so a route visited or prefetched once renders synchronously the next time. `<Link>` prefetching warms the chunk on the same triggers as the document prefetch — hover (debounced), `pointerdown`, and viewport in production — and under the same data-saver / `window.__ABSOLUTE_PREFETCH__ = false` rules. `preloadRoute(href)` does the same programmatically.

A navigation commits immediately and shows `pending` while an unprefetched chunk loads; scroll restoration waits for in-flight lazy loads (up to 3 s) before restoring a back/forward position.

### SPA route manifest

The static route scan that answers unknown SPA paths with 404 reads `<Route>` tags brace-aware, so `loader={() => import(...)}` and `guard={...}` arrow functions no longer cut a tag short and drop its `path`.

## Plain `{#await import()}`

Still works and still needs no router support: the server renders the pending branch and the browser renders `mod.default` after hydrating. Leave such a block unmarked — a block marked `<!-- absolute:stream -->` can't render a component. Prefer `loader` when the server should render the component.

## Tests

- `tests/unit/svelte/routerSsr.test.ts` — loads ask for another pass, record their source, failures, the bootstrap script.
- `tests/unit/svelte/staticAnalyzeSpaRoutes.test.ts` — routes with arrow-function attributes stay in the SPA manifest.
- `tests/integration/build/svelte-router-browser.test.ts` — the chunk isn't among the scripts the page loads, arrives on hover prefetch, a non-prefetched lazy route shows `pending` then the component, a direct request renders the component, and hydration keeps the server's node with no pending flash and no hydration warning.

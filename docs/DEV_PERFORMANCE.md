# Dev performance

How `absolute dev` gets to a first painted page quickly, which knobs
change that, and how to find out where the time went.

## Lazy page builds (the default)

`absolute dev` boots with every page entry deferred. The boot build does
the shared work — vendors, global CSS, static HTML/HTMX pages, the server
bundle — and each page's bundle is built the first time someone asks for
it. A request for an unbuilt page waits for that one build (typically
~1s) instead of the whole project's.

- The handler notices `asset()` returned `''`, builds that page, re-reads
  the manifest and renders. Concurrent requests for the same page share
  one build.
- Prefetch requests (`Sec-Purpose: prefetch`) go through the same path, so
  a hovered link warms a page that has never been built.
- `/hmr-status` reports `lazyPages` (`buildCount`, `inFlight`, `warmed`)
  and the current `manifestKeys`.

Restore the old behaviour — every page built during boot — with
`absolute dev --eager` or `ABSOLUTE_DEV_EAGER=1`. Use it when you want a
single long boot instead of a fast boot plus per-page waits (CI smoke
runs, profiling a full build).

## Profiling

`ABSOLUTE_DEV_PROFILE=1` is the one switch:

- per-step startup timings for each boot phase;
- the per-phase build trace (`ABSOLUTE_BUILD_TRACE`), written to
  `<buildDir>/.absolute-trace/`;
- one timing block per on-demand page build
  (`AbsoluteJS on-demand page build`);
- build-worker pool utilisation after each burst of work.

`absolute build` prints the slowest phases from the same trace directory.

## Knobs

| Setting | Default | Effect |
| --- | --- | --- |
| `--eager` / `ABSOLUTE_DEV_EAGER=1` | off | Build every page during boot instead of on first request. |
| `ABSOLUTE_DEV_PROFILE=1` | off | Startup timings + build trace + on-demand build lines + pool utilisation. |
| `ABSOLUTE_BUILD_WORKERS=n` | `max(2, min(cpus, 8))`, capped by free memory | Build-worker threads for `@vue/compiler-sfc` and the dev sourcemap chain. `0` or `1` runs every job inline on the main thread — the supported path for debugging. |
| `ABSOLUTE_COMPILE_CACHE=0` | on | Disable the restart-surviving Vue compile cache in `.absolutejs/compile-cache/vue/`. A cold boot then recompiles every SFC. |
| `ABSOLUTE_EARLY_LISTEN=0` | on | Don't bind the port during the boot build. With it on (default) the port answers `503` + `Retry-After` while building, instead of refusing connections. |
| `dev.bundleServerDependencies` | built-in detection | Force-bundle `node_modules` packages into SSR page bundles. See below. |

### Server dependencies stay external in dev

Dev SSR page bundles leave resolvable `node_modules` packages as bare
imports; the dev server resolves one shared copy at request time. That
keeps page bundles small and the sourcemap chain limited to your own
modules. Packages the runtime could not load as-is — unbuilt TypeScript,
`.vue`/`.svelte` files in the subtree, a Svelte export condition — are
detected and stay bundled.

Force extra packages to be bundled with `dev.bundleServerDependencies`:
package names (`'three'`), scoped globs (`'@scope/*'`), exact specifiers,
or `'*'` for the legacy inline-everything behaviour. Production builds are
unaffected.

### Shared chunks in dev

The dev client bundle is built with `splitting: true`, as production is.
Without shared chunks every page entry re-emits the whole component graph
and every post-processing pass re-reads those bytes. Shared `chunk-*.js`
files get manifest keys (`ChunkXxxx`) and are served from the dev asset
store exactly as in production.

## Link prefetch

`<Link>` warms the next navigation before the click. It renders a plain
`<a>`, so modifier clicks, `target`, `download` and cross-origin hrefs
pass straight through to the browser.

### Modes

| Mode | Trigger |
| --- | --- |
| `viewport` | Link scrolls within 128px of the viewport, plus hover / focus / pointerdown. **Production default.** |
| `hover` | Hover / focus / pointerdown only. **Development default**, so a page full of links doesn't fan out into the dev server. |
| `none` | Never. |

Hover and pointerdown are debounced by 250ms; at most two prefetches are
in flight at a time and the cache holds 16 entries (LRU). Prefetching is
skipped entirely on `Save-Data`, `2g`/`slow-2g` and
`prefers-reduced-data: reduce`.

### What gets warmed

- **Viewport** — the document. It lands in the HTTP cache with the page's
  content-hash `ETag`, so the real navigation revalidates with a `304`.
- **Hover / pointerdown** — the document *and* the route data, and
  therefore the page's client module (`<link rel="modulepreload">`) and
  its stylesheets (`<link rel="prefetch" as="style">`).
- **`prerender`** — pass `prerender` on a `<Link>` to also inject a
  speculation rule; the browser renders the whole target page in a hidden
  tab so the click is instant. Capped at two live rules.

Opt the whole page out with `window.__ABSOLUTE_PREFETCH__ = false`.

### Per framework

```tsx
// React — no react-router needed for the components subpath
import { Link, usePrefetch } from '@absolutejs/absolute/react/components';

<Link href="/pricing">Pricing</Link>
<Link href="/docs" prefetch="hover" prerender>Docs</Link>

// Or drive your own element
const { ref, ...handlers } = usePrefetch('/pricing');
<a href="/pricing" ref={ref} {...handlers}>Pricing</a>;
```

`@absolutejs/absolute/react/router` exports the same `Link` and
`usePrefetch` alongside `UniversalRouter`. Inside a `<UniversalRouter>` a
matching `href` navigates client-side through react-router instead of
loading a document.

```vue
<script setup lang="ts">
import { Link, usePrefetch } from '@absolutejs/absolute/vue';
</script>

<template>
	<Link href="/pricing">Pricing</Link>
	<Link href="/docs" prefetch="hover" prerender>Docs</Link>
</template>
```

```svelte
<script lang="ts">
	import Link from '@absolutejs/absolute/svelte/router/Link.svelte';
</script>

<Link to="/pricing">Pricing</Link>
<Link to="/docs" prefetch="hover" prerender>Docs</Link>
```

The primitive underneath is framework-neutral:

```ts
import { prefetch, speculate } from '@absolutejs/absolute/client/prefetch';

prefetch('/pricing');                     // document
prefetch('/pricing', { kind: 'route' });  // document + route data + assets
prefetch('/js/chunk.js', { kind: 'module' });
speculate('/pricing');                    // prerender speculation rule
```

### Declarative preloads in the head

`generateHeadElement` (and React's `<Head>`) accept `Metadata.preload` and
`Metadata.speculationRules` for links you know about at render time:

```ts
generateHeadElement({
	preload: [
		{ href: '/assets/fonts/inter.woff2', as: 'font', crossorigin: 'anonymous' },
		{ href: '/react/indexes/Pricing-abc.js', module: true }
	],
	speculationRules: { prerender: ['/pricing'], prefetch: ['/docs'] },
	title: 'Home'
});
```

### The route-data media type

A page handler answers `Accept: application/vnd.absolute.route+json` with
the props and assets a client needs before navigating — no page render, no
client identity headers, `GET` only, in every environment:

```jsonc
{
	"protocol": 1,
	"kind": "route",
	"pageId": "VueExample",
	"framework": "vue",
	"props": { "initialCount": 0 },
	"status": 200,
	"assets": {
		"index": "/_src_indexes/VueExample-abc.js", // client entry, modulepreloaded
		"client": "/vue/client/VueExample-def.js",  // optional second module
		"css": ["/css/VueExample-abc.css"]          // prefetched as style
	},
	"head": { "title": "AbsoluteJS + Vue" }
}
```

The response carries `ETag` + `Cache-Control: private, max-age=0,
must-revalidate`, so a prefetched copy and the request that follows it
revalidate with a `304`. React, Vue, Svelte, Angular, Ember and static
HTML/HTMX pages all answer it; the assets are whatever manifest keys the
handler already resolved (React pages own their `<head>` inside the
component, so they report the client entry only). A server that doesn't
implement it (an older version, a proxied route) answers `404` / `406`,
which the client remembers as "no data" and never asks for again.

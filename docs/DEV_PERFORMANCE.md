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

## Where a dev boot's time actually goes

`absolute dev` runs two processes: the CLI parent and the `bun --hot`
child that serves. `ABSOLUTE_DEV_PROFILE=1` prints one timeline across
both (`AbsoluteJS boot timeline`, offsets from CLI start), which is the
only view that explains the wall clock — the per-step blocks inside each
process cannot, because their awaits interleave with whatever else holds
the thread.

The child's boot is **single-threaded and CPU bound**. Evaluating the
user's server entry (a large app imports well over a hundred packages at
the top level) and running the framework's boot build compete for the
same JS thread, so moving the build earlier only interleaves the two — it
does not make either cheaper. The build starts as early as it can already:
`dev/serverBootstrap.ts` kicks off `startDevPrebuild()` right after the
early listener binds and before the user's entry is imported, and the
user's later `prepare()` joins that promise instead of starting a second
build (`prepare() joined prebuild` in the timeline).

What *is* free is the CLI parent. From the spawn until the child prints
`ready` it does nothing but forward stdout, so the two boot steps that are
pure functions of what is on disk run over there instead:

- the dependency-vendor specifier scan (every source file under the
  configured framework directories, then the matching packages in
  `node_modules`);
- the initial HMR dependency graph (every watched source file's imports).

The parent writes both to `.absolutejs/dev-prescan/<pid>.json` and the
child adopts them (`adopt CLI pre-scan` in the devBuild timing block,
followed by near-zero `initialize dependency graph` and
`prepare dep vendor paths` steps). The payload records which directories
the scan covered; if they do not match what this process would have
scanned, or the file is late or malformed, the child simply scans for
itself.

It does remove real work from the child: on a 74-page app the two steps go
from 275-659ms and 712-1380ms to single-digit milliseconds.

It is still **off by default**, because on that app the saving does not
reach the user. The child cannot adopt the payload until the user's own
`server.ts` has finished importing, and those scans were running inside
that same window — so removing them moves the finish line of a race that
something else was already losing. An alternating A/B on an idle machine
put the two within noise of each other:

| | first paint | first page | ready |
| --- | --- | --- | --- |
| pre-scan on | 3.4s / 3.8s | 5.4s / 6.5s | 3.97s / 4.47s |
| pre-scan off | 3.3s / 3.6s | 5.1s / 6.0s | 3.93s / 4.30s |

Given a tie, the default is the one without a cross-process handshake.
Turn it on with `ABSOLUTE_DEV_PRESCAN=1` when your source tree is large but
your server entry imports little — then there is no import window for the
scans to hide in, and the saving above should show up in wall clock.

## Which of your imports is actually costing you

Past a certain size the slowest thing in a dev boot is the app's own
`server.ts` evaluating its module graph, and no framework change can shrink
that — it is the developer's code. On a 74-page app, 111 top-level imports
account for around 3.5s of a 5.5s boot.

The obvious way to find the expensive one is to import each specifier in turn
and time it. That measurement lies. Done on the app above it reports
`./plugins/enterpriseAuthPlugin` at 1386ms, but that module's own direct
dependencies cost 3ms, 2ms and 18ms: the 1386ms is first-touch of a subgraph
that almost every other import also uses. Defer it and the cost moves to
whichever import loads next. Whole-subgraph measurements have the same
problem from the other side — on that app the pages, enterprise and voice
subtrees measure 2137ms, 1778ms and 1616ms in fresh processes and overlap so
heavily that adding them is meaningless.

`ABSOLUTE_DEV_IMPORT_COST=1` answers the question that leads somewhere
instead: **if I deferred this import, how much boot time would actually go
away?**

```
$ ABSOLUTE_DEV_IMPORT_COST=1 bun run dev

AbsoluteJS import cost — src/backend/server.ts
3358ms of module evaluation across 2056 modules, 111 top-level imports.

    saving modules  import                                      verdict
     592ms     160  ./plugins/apiPlugin                         used at module scope
      27ms       1  @absolutejs/auth/server                     deferrable
      23ms       8  ./plugins/uploadthingFileRouterPlugin       used at module scope
  108 more          imports below 15ms — 68ms between them

  shared base: 2649ms across 1817 modules — reached through more than one
  import (or loaded before the entry), so deferring any single import does not remove it.
  1852ms was the entry's own body — the work it does after its imports,
  including the boot build it waits on. No import can move that.
  79ms more ran outside the instrumented modules (CommonJS dependencies, native
  modules, the concurrent boot build) and is credited to no import.
```

Read that top-down and the answer is uncomfortable but true: on this app
there is no import worth deferring. One import owns 592ms and it is used at
module scope; everything else owns tens of milliseconds; 2649ms is shared
between imports and stays no matter which one you move.

### How the saving is computed

**Dominators, not subtree totals.** Deferring an import removes exactly the
modules that become unreachable without it — the ones it *dominates*. The
report removes each candidate edge from the module graph, re-runs
reachability from the process root, and sums the self time of what
disappeared. A module reached through two of the entry's imports disappears
from neither, so it lands in the shared base instead of being credited twice.

Reachability starts at the **dev bootstrap**, not at your entry. That is what
keeps the framework runtime — which the bootstrap loads on its own — out of
whichever import happened to touch it first. Anything that loaded with no
recorded importer is hung off that root for the same reason: it stays counted
but cannot be claimed by an import.

**Self time excludes children.** Every module is bracketed with an enter call
at the top of its body and an exit call at the end. In ESM that is exclusive
of static children for free — a module's body does not start until everything
it imports has finished evaluating. CommonJS nests instead, and so do dynamic
imports awaited inside a body; a stack subtracts those. Parsing is measured
separately, from the gap between one module's load and the next one's, and
the plugin's own read-and-rewrite is bracketed out so instrumentation
overhead is never charged to a module.

**Lazy edges count as edges.** A `require()` or an `import()` inside a
function still becomes an edge in the graph. That can only make a module look
*more* shared than it is, which understates a saving. Overstating one is the
failure this whole diagnostic exists to avoid, so every judgement call goes
that way.

### The verdict column

A saving you cannot collect is worthless, so every candidate is also checked
against the entry's source with the TypeScript compiler API:

| verdict | meaning |
| --- | --- |
| `deferrable` | every binding it introduces is referenced only inside function or method bodies. Move the import into the function and the saving is yours. |
| `used at module scope` | at least one reference runs during module evaluation — at top level, in a decorator, in a class-field initializer, or re-exported from the entry. Deferring it needs a refactor, not a moved line. |
| `side-effect import` | `import "x"` with no bindings. Never deferrable, and usually order-sensitive: `reflect-metadata` has to be first or every tsyringe-based dependency throws. |

The classifier is one-sided on purpose. Where it cannot prove a reference is
deferred it says `used at module scope`, so it under-reports deferrable
imports and never claims one that is not. Type-only imports are left out of
the table entirely — they are erased and never load.

### What it cannot see

Bun 1.4 has no CommonJS loader for plugins: an `onLoad` hook must return
contents, and whatever it returns is parsed as an ES module. Instrumenting a
CommonJS dependency therefore breaks it. So the recorder covers your own
source, `.mjs` anywhere, and packages that declare `"type": "module"` —
Node's own rule, including nested manifests, so a CommonJS build shipped
inside an ESM package (`entities/dist/commonjs/`) stays out.

What is left out is not mis-attributed. It evaluates outside every
instrumented module's body, so it is charged to the process root and printed
on the `ran outside the instrumented modules` line rather than credited to
one of your imports.

Two more things the numbers do not include: the entry's own body — where
`prepare()` and the boot build it waits on live — is reported on its own line
and excluded from the total, and the boot build is not started early under
this flag (see below), so a measured boot is slower than a normal one.

### Cost of measuring

The flag is off by default and costs nothing when off: no extra `--preload`
argument reaches the dev child, and the bootstrap does one undefined property
read. With it on, expect a slower boot — the recorder rewrites every module
it loads (about 90ms on the app above, reported and excluded), the analysis
runs after the entry finishes importing, and `startDevPrebuild()` is
suppressed. Its build would otherwise run inside the same wall-clock gaps the
per-module numbers come from and land on whichever module happened to be
parsing, which is exactly the misattribution the flag exists to avoid.

`ABSOLUTE_DEV_IMPORT_COST_DUMP=<path>` writes the raw measurement (module
paths and the event log) alongside the report, so an attribution can be
re-derived without another boot.

## Knobs

| Setting | Default | Effect |
| --- | --- | --- |
| `--eager` / `ABSOLUTE_DEV_EAGER=1` | off | Build every page during boot instead of on first request. |
| `ABSOLUTE_DEV_PROFILE=1` | off | Startup timings + build trace + on-demand build lines + pool utilisation. |
| `ABSOLUTE_DEV_IMPORT_COST=1` | off | Per-import cost report for your server entry: how much boot time deferring each top-level import would actually remove. Slows the boot it measures — see above. |
| `ABSOLUTE_DEV_IMPORT_COST_DUMP=path` | off | With the above, also write the raw measurement to `path` as JSON. |
| `ABSOLUTE_BUILD_WORKERS=n` | `max(2, min(cpus, 8))`, capped by free memory | Build-worker threads for `@vue/compiler-sfc` and the dev sourcemap chain. `0` or `1` runs every job inline on the main thread — the supported path for debugging. |
| `ABSOLUTE_COMPILE_CACHE=0` | on | Disable the restart-surviving Vue compile cache in `.absolutejs/compile-cache/vue/`. A cold boot then recompiles every SFC. |
| `ABSOLUTE_EARLY_LISTEN=0` | on | Don't bind the port during the boot build. With it on (default) the port answers `503` + `Retry-After` while building, instead of refusing connections. |
| `ABSOLUTE_DEV_PRESCAN=1` | off | Pre-scan the source tree in the CLI parent instead of the dev child. Measured slower on a real app — see above before turning it on. |
| `ABSOLUTE_DEV_PRESCAN_WAIT_MS=n` | `2000` | With the pre-scan on, how long the child waits for the parent's payload before giving up and scanning itself. |
| `ABSOLUTE_DEV_PREBUILD=0` | on | Don't start the boot build from the dev bootstrap; wait for the user's `prepare()` call. |
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

### Vue helper emission

A Vue page's components import plain `.ts` helpers (stores, composables,
shared utilities) and every one of them is transpiled into both generated
trees so the relative imports inside the compiled intermediates resolve.
`cleanup/generated` wipes those trees after every build, so this repeats
on every build — including each on-demand page build. On a large app that
is several hundred files per build, and it was the single largest slice of
an on-demand page build.

Three things keep it small:

- the helper graph is walked breadth-first in waves, so the hundreds of
  reads happen concurrently instead of one await at a time;
- the transpile itself runs on the build worker pool
  (`ABSOLUTE_BUILD_WORKERS`), through the same handler the inline path
  uses, so the emitted bytes never depend on which thread ran it;
- the emitted bytes are a pure function of the source text and the
  framework version, so they are cached under
  `.absolutejs/compile-cache/vue-helpers/` and copied back when the source
  has not changed. Entries are content addressed and superseded entries
  for a path are removed as it is rewritten. `ABSOLUTE_COMPILE_CACHE=0`
  disables this along with the SFC compile cache.

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

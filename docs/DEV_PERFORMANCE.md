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

### What the saving is, and is not

The saving is the **module-graph work that stops happening**: the parse and
evaluation of the modules that edge alone reaches. On the app above, deleting
`./plugins/apiPlugin` really does take the graph from 2056 modules to 1896 —
exactly the 160 the report named — so the *set* is not an estimate.

The stopwatch moves by less than the number. Measured on that app, removing
that import cut `ready` by ~0.3s against ~0.55s of module work. Two things
account for the difference and both are worth knowing:

- a normal dev boot runs `startDevPrebuild()` **concurrently** with your
  entry's import, so import work removed from the CPU partly hides under
  build work that happens either way. This flag turns that overlap off while
  measuring, which is what makes per-module attribution possible at all;
- parse time is inferred from the wall-clock gap between one module's load
  and the next one's. A gap is only credited to a module when everything it
  imports was itself instrumented — otherwise Bun spent part of it on a
  CommonJS subtree with no events of its own — but a gap can still catch a
  garbage collection or another thread landing on this one.

So read a saving as *the size of the thing you would be removing*, and treat
the milliseconds as an upper bound on what the clock will show. The ordering
and the shared-base split are what tell you where effort is worth spending.

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

### Finding out you needed this

Nobody runs a flag they have never heard of, and nobody re-runs it a year
later when a colleague adds a heavy import. So a dev boot that would benefit
says so itself, in one line:

```
[absolute] 2.65s of this boot was your server entry's imports — ABSOLUTE_DEV_IMPORT_COST=1 shows which ones own it.
```

The number is not wall clock. Most of a dev boot is the build, which no
import can move, so the trigger is the window between two boot marks —
`server entry import start` to `framework runtime imported`. It opens when
the bootstrap begins importing your entry and closes when the framework
runtime starts its own body, which is strictly before your entry can reach
`prepare()`. Everything inside it is module evaluation; none of it is build
work.

It is deliberately a *lower* bound on your entry graph — on the app above the
entry keeps importing for another three seconds after the framework runtime
lands. Under-reporting is the right direction: a hint that fires when there
is nothing to find becomes noise, while one that misses a boot with a second
of imports left in it costs nothing but an opportunity.

The default threshold is 1500ms (`ABSOLUTE_DEV_IMPORT_COST_HINT_MS`). Below
about a second a restart still reads as continuous; the margin over that is
so a single boot on a loaded machine cannot trip a hint the app does not
deserve; and the diagnostic being suggested costs a slower boot to run, so
suggesting it for a sub-second graph asks for more time than could ever be
recovered.

A hint on every boot is read once and ignored forever, so it stays silent for
anyone it cannot help. It does not print when the boot was under the
threshold, on a `bun --hot` re-evaluation (a warm graph describes nothing you
can act on), under `--eager` (you asked for one long boot), in CI
(`process.env.CI`), when stdout is not a terminal (a pipe, a log scraper, a
benchmark harness), when `ABSOLUTE_DEV_IMPORT_COST=1` is already on, or when
`ABSOLUTE_DEV_IMPORT_COST_HINT=0`. Suppressed, it costs a few environment
reads. `ABSOLUTE_DEV_IMPORT_COST_HINT=1` forces it past the interactivity
gates — useful through a pipe — but never past the threshold.

The boot marks behind it are recorded on every dev boot (about twenty
`Date.now()` calls); `ABSOLUTE_DEV_PROFILE=1` still controls whether the
timeline is *printed*.

### The same verdicts in CI

A heavy import lands in a pull request, not in a boot, and the measurement
needs a dev boot. But the `verdict` column above is static — one parse with
the TypeScript compiler API — so it also runs in `absolute typecheck`, which
already walks the project and already runs in CI.

A passing check adds two lines when your server entry has any:

```
✓ Typecheck passed
i 49 imports are used only inside functions in src/backend/server.ts — deferrable in shape, not necessarily worth deferring.
  Run `absolute typecheck --import-advice` to list them, or ABSOLUTE_DEV_IMPORT_COST=1 on a dev boot to measure what they cost.
```

`absolute typecheck --import-advice` (or `ABSOLUTE_IMPORT_ADVICE=1`) lists
them with line numbers. That listing is behind a flag on purpose: a green run
that printed a hundred lines of advice would train everyone to stop reading
the output, and the advice would go with it.

**It reports shape, not cost, and it never fails the build.** A `deferrable`
verdict means every binding the import introduces is referenced only inside a
function body, so moving the import into that function is a mechanical change
rather than a refactor. It says nothing about whether that is worth doing —
static analysis cannot tell a 5ms import from an 800ms one. On the app above
it finds 49 of 111 top-level imports deferrable in shape, and the measured
report rates exactly one of them worth 27ms. Failing on the other 48 would
gate merges on a measurement nobody has taken, and a check that fails for no
good reason stops being run. So the exit code stays governed by real type
errors, and the advice points at `ABSOLUTE_DEV_IMPORT_COST=1` for the number.


## Deferring a route-owning plugin

The verdict column above has one entry it cannot help you with. A plugin that
owns routes is `used at module scope` by construction: `.use(apiPlugin(db))`
runs during module evaluation, because Elysia composes routes at `.use()` time
and freezes them into Bun.serve's handler table at `.listen()`. Moving the
import into a function is not an option — there is no function. On the 74-page
app that one plugin is the largest attributable import in the entry, and no
amount of care in the app's own code removes it.

`lazyPlugin` makes the deferral something you call:

```ts
import { lazyPlugin } from '@absolutejs/absolute';

export const app = new Elysia()
	.use(
		lazyPlugin({
			args: [db],
			prefix: '/api',
			load: () => import('./plugins/apiPlugin')
		})
	);
```

It registers two placeholder routes at composition time — `/api` and
`/api/*` — so the app answers under that prefix from the moment it listens.
The first request that lands on one of them imports the module, composes it
onto the live app with the real `.use()`, and re-dispatches. Concurrent first
requests share one import. Every request after that matches the plugin's own
routes directly: the placeholders never win against a concrete route, so the
steady-state cost is nothing at all, not even a prefix check.

### The prefix is the requirement

A lazy plugin has to own a path prefix, and own it exclusively. That prefix is
the entire reason the app can answer before the module exists — it is what the
placeholders are registered for. `lazyPlugin` throws at composition time if the
prefix is missing, `/`, or does not start with a slash.

- The plugin's routes must all live under it. In practice this means the
  plugin already looks like `new Elysia({ prefix: '/api' })`, which is how a
  mounted API surface is usually written anyway.
- Nothing else may claim it. The placeholders are registered where you call
  `lazyPlugin`, so a route the parent declared at exactly `/api` earlier in the
  chain would be shadowed until the mount happens.
- Matching is by path segment, not by string: `/api` covers `/api` and
  `/api/anything`, and never `/apiary`.

A request under the prefix that the plugin turns out not to serve gets the same
`404` the app would have produced with an eager `.use()` — including a custom
not-found page, because the placeholder raises Elysia's own `NotFound` rather
than writing a response of its own.

### What `load` may return

`load` is called once. It may resolve to any of these:

| shape | example |
| --- | --- |
| the plugin | `load: () => apiPlugin(db)` |
| a module's default export | `load: () => import('./api')` with `export default` |
| a module with exactly one plugin export | `load: () => import('./api')` |
| a factory, called with `args` | `load: () => import('./api')`, `args: [db]` |

The last two are the ergonomic ones and cover the common case — a module whose
only export is `apiPlugin`, a factory taking the database — but they resolve at
runtime, so TypeScript cannot check that `args` matches the factory. When you
want that checked, bind the dependencies in the closure instead and let `load`
return the finished plugin:

```ts
load: async () => (await import('./plugins/apiPlugin')).apiPlugin(db)
```

Anything else — an ambiguous namespace, a factory that returns something other
than an Elysia instance — fails on the first request with an error that names
the exports it found. A `load` that throws is retried by the next request, so a
module you are in the middle of fixing does not need a restart; a failure while
composing the resolved plugin is replayed instead, because the plugin is
already spliced into the app and cannot be composed twice.

### In production it is a plain `.use()`

`lazyPlugin` defers only outside production. With `NODE_ENV=production` (or
inside a compiled binary) it takes the eager path: it hands the loaded plugin
straight to `.use()`, which `.listen()` awaits before it serves anything. No
placeholder routes are registered, no request pays for a mount, and the route
table is the one the plugin declares. Force either path with `eager: true` /
`eager: false`.

This is deliberate, and it is the honest version of "identical to `.use()`".
Two things about a deferred mount cannot be reproduced exactly, and both are
inherent to `import()` rather than to this implementation:

- **Registration order.** A plugin composed on the first request lands at the
  end of the chain, so a global hook the parent registers *after* the
  `lazyPlugin(...)` call also wraps its routes, where an inline `.use()` at
  that position would have run before those hooks existed. Elysia's own
  `use(import('./x'))` has the same property.
- **One doubled lifecycle.** The single request that triggers the mount passes
  through the app's outermost request lifecycle twice — once to reach the
  placeholder, once for the re-dispatch. Fetch-level `request` hooks, and
  anything counting requests, see that one request twice.

Neither is a fair trade in production, where the module has to load before the
first request anyway and there is nothing to win. Both are invisible in dev,
which is where the whole saving is.

Everything else goes through untouched, because the re-dispatch hands the
original `Request` to the app's own fetch handler: request bodies (the
placeholder never parses them), streaming and SSE responses, and the
`Sec-Purpose: prefetch` requests `<Link>` makes — a prefetch under the prefix
warms the plugin exactly like a real navigation. WebSocket routes upgrade too:
if the plugin is the first thing on the app to declare one, the socket handler
is installed at mount time through the same Bun reload the dev HMR path uses.

### The before and after

On the 74-page app, converting one registration —

```diff
-import { apiPlugin } from './plugins/apiPlugin';
-
-	.use(apiPlugin(db))
+	.use(
+		lazyPlugin({
+			args: [db],
+			prefix: '/v1',
+			load: () => import('./plugins/apiPlugin')
+		})
+	)
```

— takes the diagnostic from this:

```
AbsoluteJS import cost — src/backend/server.ts
5429ms of module evaluation across 1726 modules, 111 top-level imports.

    saving modules  import                                      verdict
    1051ms     158  ./plugins/apiPlugin                         used at module scope
      48ms       3  ./plugins/uploadthingFileRouterPlugin       used at module scope
  109 more          imports below 15ms — 61ms between them
```

to this:

```
AbsoluteJS import cost — src/backend/server.ts
5322ms of module evaluation across 1568 modules, 110 top-level imports.

    saving modules  import                                      verdict
     971ms      20  ./integrations/syncEngine                   used at module scope
      19ms       4  ./plugins/uploadthingFileRouterPlugin       used at module scope
      16ms       4  ./plugins/smsPlugin                         used at module scope
  107 more          imports below 15ms — 54ms between them
```

The 158 modules are gone from the graph — 1726 down to 1568, exactly the set
the report named — and the entry no longer has an import it cannot defer.

Read the new top line the way the section above says to read it: the cost did
not vanish from the process, it moved to whichever import now reaches the
shared subgraph first. That is the diagnostic working, not failing. The `saving`
column has always meant "the size of the thing you would be removing", and what
was removed here is real: those 158 modules are not parsed, not evaluated, and
not on the path to a ready server.

The stopwatch, on this app and this machine, does not move. Two alternating
five-run comparisons of the same app — eager `.use()` against the deferred
mount, warm boots, nothing else running — came back a tie on every metric, and
the direction flipped between sessions:

| | eager | lazy | |
| --- | --- | --- | --- |
| ready (session 1) | 7.20s | 7.26s | tie |
| first page (session 1) | 9.24s | 10.55s | tie |
| ready (session 2) | 6.40s | 6.61s | tie |
| first page (session 2) | 9.23s | 8.76s | tie |

Run-to-run spread on that machine is 3–7s, so a ~1s change cannot be seen
through it. That is the honest result, and it is consistent with the section
above: the boot build runs concurrently with the entry's imports and hands most
of its work to the build-worker pool, so main-thread import work removed from
the critical path partly lands in a gap the boot was going to spend waiting
anyway.

So the reason to reach for `lazyPlugin` is not a promised second off `ready`.
It is that the largest single item in the diagnostic stops being unfixable —
158 modules leave the boot's graph, the entry's import list gets shorter, and
on a machine or a codebase where import work *is* the bottleneck the saving is
there to collect. Measure your own app before and after; a tie is a legitimate
answer, and so is finding that this one plugin was the whole problem.

### What it costs

- **The first request under the prefix waits for the import.** On the app
  above that is most of a second, once, for whoever hits the API first. A dev
  who only loads pages never pays it at all.
- **The plugin's routes leave the app's TypeScript type.** `lazyPlugin`
  returns the app unchanged, so an Eden treaty client built from `typeof app`
  no longer sees those routes. Apps that anchor their client types per feature
  rather than off the root server type are unaffected; apps that do not should
  keep the eager path.
- **Two placeholder routes stay in the route table** for the life of the
  process. They are hidden from the OpenAPI document and unreachable once the
  plugin is mounted.

## Knobs

| Setting | Default | Effect |
| --- | --- | --- |
| `--eager` / `ABSOLUTE_DEV_EAGER=1` | off | Build every page during boot instead of on first request. |
| `ABSOLUTE_DEV_PROFILE=1` | off | Startup timings + build trace + on-demand build lines + pool utilisation. |
| `ABSOLUTE_DEV_IMPORT_COST=1` | off | Per-import cost report for your server entry: how much boot time deferring each top-level import would actually remove. Slows the boot it measures — see above. |
| `ABSOLUTE_DEV_IMPORT_COST_DUMP=path` | off | With the above, also write the raw measurement to `path` as JSON. |
| `ABSOLUTE_DEV_IMPORT_COST_HINT=0` | on | Silence the one-line hint a slow dev boot prints pointing at `ABSOLUTE_DEV_IMPORT_COST=1`. `=1` forces it past the CI/`--eager`/terminal gates, but never past the threshold. |
| `ABSOLUTE_DEV_IMPORT_COST_HINT_MS=n` | `1500` | Milliseconds of entry-graph module evaluation above which that hint prints. |
| `absolute typecheck --import-advice` / `ABSOLUTE_IMPORT_ADVICE=1` | off | List the server entry's deferrable-in-shape imports instead of the two-line summary. Never changes the exit code. |
| `ABSOLUTE_BUILD_WORKERS=n` | `max(2, min(cpus, 8))`, capped by free memory | Build-worker threads for `@vue/compiler-sfc` and the dev sourcemap chain. `0` or `1` runs every job inline on the main thread — the supported path for debugging. |
| `ABSOLUTE_COMPILE_CACHE=0` | on | Disable the restart-surviving Vue compile cache in `.absolutejs/compile-cache/vue/`. A cold boot then recompiles every SFC. |
| `ABSOLUTE_EARLY_LISTEN=0` | on | Don't bind the port during the boot build. With it on (default) the port answers `503` + `Retry-After` while building, instead of refusing connections. |
| `ABSOLUTE_DEV_PRESCAN=1` | off | Pre-scan the source tree in the CLI parent instead of the dev child. Measured slower on a real app — see above before turning it on. |
| `ABSOLUTE_DEV_PRESCAN_WAIT_MS=n` | `2000` | With the pre-scan on, how long the child waits for the parent's payload before giving up and scanning itself. |
| `ABSOLUTE_DEV_PREBUILD=0` | on | Don't start the boot build from the dev bootstrap; wait for the user's `prepare()` call. |
| `dev.bundleServerDependencies` | built-in detection | Force-bundle `node_modules` packages into SSR page bundles. See below. |
| `lazyPlugin({ eager })` | production and compiled binaries | Force a lazily mounted plugin onto the eager `.use()` path (`true`) or the deferred one (`false`). See above. |

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

### Whole-project scans

Two build phases do not scope to the page being built: `scan/worker-references`
walks every source file under the framework directories looking for
`new URL('./x', import.meta.url)` and `import.meta.resolve('./x')`, and
`scan/vue-ssr-only` walks every `.ts` under the project root looking for
`handleVuePageRequest({ client: 'none', ... })`. A production build runs each
once. Dev runs them on every on-demand page build, against a tree that
usually has not changed since the last page opened — on a 1451-file app that
was ~116ms and ~64ms of pure repeated work per warm page build.

Each file's contribution is now memoised behind a `(mtimeMs, size)` stamp
(`src/build/stampedFileCache.ts`). The directory walk still runs every time —
it is 3-5ms and it is what makes the memo sound — and only the per-file read,
regex and `ts.createSourceFile` are skipped for files that have not changed.
Warm, that is ~24ms and ~16ms.

The memo is keyed on the file stamp rather than on the dev watcher's change
stream, because the watcher's positive roots are directories
(`getWatchPaths`): a file sitting directly at the project root — `server.ts`,
`vueImporter.ts` — never reaches `queueFileChange` at all, and
`htmlDirectory`/`htmxDirectory` are watched only under `pages/`, `scripts/`
and `styles/`. Both scans read outside that coverage, and the Vue SSR-only
scan reads the entire project root, so an event-driven memo would go stale on
exactly the edit that matters: a `client: 'none'` added to a root-level server
entry. Re-stat'ing the walked files has no such hole and costs about 1ms per
1500 files.

Two rules keep the memo equal to an uncached scan rather than merely close to
one:

- only the *content-derived* part of a file's contribution is cached. The
  worker scan caches the raw specifiers a file references and redoes the
  existence check for each one on every pass, because a specifier's target can
  appear or disappear without the referencing file changing at all;
- a stamp is only trusted once it is two seconds old. Most filesystems a
  source tree lives on stamp with nanosecond resolution, but a few (ext3,
  HFS+, some network mounts) round to the second, and there a second edit of
  the same byte length within the same second would carry a stamp already
  recorded. Files touched inside that window are recomputed and deliberately
  left out of the cache — which is the same set that had to be recomputed
  anyway.

Memoisation is dev-only. A production build scans once, so it opts out and
pays no stat pass.

The benchmark harness cannot show this saving: it opens one page, so the only
on-demand build it measures is the first one — the build whose scans are cold
and populate the memo. The win starts at the second page open.

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

On a 667-helper app the scan and the emit split roughly 100ms to 50ms per
warm page build. The scan traces the import graph from source and runs
whether or not the generated tree was wiped, so it is the larger target — but
it is not read-bound (reading all 667 files is ~6ms); it is dominated by the
`existsSync` probes that resolve each relative helper specifier, which depend
on the state of the filesystem and so cannot be memoised on file content.

Not wiping the generated tree would remove the ~50ms emit entirely, and that
was measured and rejected. The tree is served as executable code by the dev
module server, so a stale file in it is shipped to the browser; a
version-plus-content key catches edits but not deletions, so a helper removed
by a branch switch would leave a resolvable orphan behind; and the same
directory holds compiled SFC intermediates and hydration indexes, so retaining
it selectively means a per-framework cleanup contract — which is what the
Angular exemption already is, and it carries a comment about the races that
caused. 50ms is not worth that.

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

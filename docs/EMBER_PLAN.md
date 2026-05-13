# Ember.js Adapter — Parity Plan

Goal: make Ember a first-class framework in AbsoluteJS at the same level as
React / Svelte / Vue / Angular. "First-class" means the user can pick Ember in
`defineConfig`, drop pages into `ember/pages/`, and get SSR + islands + HMR +
streaming slots + Tailwind + conventions for free, with the same ergonomics as
the existing adapters.

## 0. Status & Ember version target

- Target: **Ember 6.12 LTS** (released 2026-05-01) initially, with a single
  7.0-readiness audit at the end of phase 2 (see §0.1).
- **Build pipeline: Bun, not Vite.** AbsoluteJS uses `Bun.build` and
  `Bun.Transpiler` for every adapter; the Ember adapter is no exception.
  Ember's *own* default scaffold standardized on Embroider + Vite in 6.x,
  but we reach below that layer and call Glimmer's compile APIs as a
  library, the same way `compileSvelte.ts` calls `svelte/compiler` and
  `compileVue.ts` calls `@vue/compiler-sfc` directly. We will not ship,
  spawn, or depend on Vite at runtime or build time.
- Classic ember-cli output is also not supported — pages are authored as
  gjs/gts/ts and compiled in-process.
- Rendering API: `renderComponent()` from ember-source (introduced in 6.8) — a
  direct Glimmer component → string render call. This is what makes an
  AbsoluteJS adapter tractable; do not depend on FastBoot.

## 0.1 Ember 7.0 watch

7.0 is expected ~late May 2026 (Ember's 18-month major cadence; 6.0 shipped
Nov 2024, 6.12 LTS shipped May 1 2026 as the standard pre-major handoff).
**Self-monitor; no scheduled agent.**

What is **not** changing in 7.0 — and so is safe to build against now:

- `renderComponent()` and the rest of the rendering surface — Ember's major
  policy is "majors only remove deprecated APIs, they never add features".
  Anything we rely on for SSR is already in 6.x.
- Library-form Glimmer compilation. The compile entry points
  (`@glimmer/compiler`, `content-tag`) are the public seam Embroider+Vite
  uses too; that seam isn't going anywhere, even though we don't run
  Embroider or Vite ourselves.
- Glimmer VM living inside the `emberjs/ember.js` monorepo (consolidated in
  6.12).
- `@warp-drive/*` data-layer naming (already the default blueprint package).
- `<template>` tag / gjs / gts authoring — these are in the strict-mode
  template ecosystem and not on any deprecation track.

What **may** change in 7.0 and would force adapter edits:

- **Deprecated API removals.** This is the real risk. Anything in
  `compileEmber.ts`, `buildEmberVendor.ts`, or `pageHandler.ts` that imports
  from a path the 6.x deprecation list flagged will break on 7.0. The audit
  is mechanical: read the 7.0 release notes, grep the adapter for any
  symbol/path mentioned in the removal list, replace.
- **Vendor specifier list.** §2.5 lists `ember-source/runtime`,
  `@glimmer/component`, `@glimmer/tracking`, `@ember/runloop`. Any of these
  could be renamed or re-pathed in 7.0 as part of the post-monorepo cleanup.
  Re-resolve against `node_modules/ember-source/package.json` exports map on
  7.0 day 1.
- **HMR runtime symbol** (§3.3). If Glimmer's HMR hook surface lands or
  changes shape with 7.0, that's good news for us — it would let us drop
  the remount fallback for true rerender. The Embroider Vite plugin
  changelog is a useful leading indicator — read it for signal, don't
  adopt the plugin.
- **content-tag preprocessor.** If the gjs/gts extraction story moves
  upstream into ember-source itself (plausible post-monorepo), we may be
  able to drop a dependency.
- **Stage-3 decorator migration.** [Confirmed during Phase 1 dryrun:
  `@tracked`, `@service`, `@action` and the rest of the Glimmer/Ember
  decorator surface are still authored against the
  legacy/TypeScript-style decorator semantics — they crash with
  `TypeError: Properties can only be defined on Objects` under modern
  TC39 stage-3 decorator runtimes. Bun.Transpiler defaults to stage-3,
  so `compileEmber.ts` sets `experimentalDecorators: true` to stay
  compatible with current Glimmer.] What to watch for: a release note
  in 7.x or any 6.x patch that mentions "stage-3 decorators" or
  "TC39 decorators" landing in `@glimmer/tracking`, `@ember/object`,
  or `@glimmer/component`. The Embroider/Glimmer build-system
  changelog (`embroider-build/embroider`) is the leading indicator —
  decorator-runtime changes ship there before any Ember release.
  When it lands: drop `experimentalDecorators` and
  `useDefineForClassFields: false` from the `Bun.Transpiler` config in
  `compileEmber.ts`, run the dryrun `Hello.gts` page through the
  pipeline, confirm `@tracked` still initializes class fields. If
  Ember NEVER migrates: we can author the migration ourselves —
  `@tracked` is ~50 lines in `@glimmer/tracking`, and adding a
  stage-3-shaped decorator alongside the legacy one is a clean PR.
  Worst-case the AbsoluteJS adapter ships its own
  `@absolutejs/glimmer-tracked` shim that users import instead. The
  migration is mechanical; the blocker is upstream willpower, not
  technical complexity.

Audit trigger: 7.0 release announcement on blog.emberjs.com. Audit cost
estimate: ~½ day. Net expected effect on the plan below: small — most
likely a vendor specifier rename and zero or one symbol replacement.

## 0.2 RFC #1178 watch — `isInteractive` / `hasDOM` / non-`Document` deprecation

**Tracking**: [emberjs/rfcs#1178](https://github.com/emberjs/rfcs/pull/1178)
**Implementation PR**: [emberjs/ember.js#21348](https://github.com/emberjs/ember.js/pull/21348)
**Stage**: accepted (proposed for v8). Discovered during Phase 1 dryrun
when [emberjs/ember.js#21364](https://github.com/emberjs/ember.js/pull/21364)
review surfaced the broader direction.

The RFC removes three things our Phase 1 adapter currently uses:

- `env.isInteractive` on `renderComponent` (we pass `isInteractive: false`)
- `env.hasDOM` on `renderComponent` (we pass `hasDOM: true`)
- non-`Document` values for the `document` field — i.e. simple-dom as the
  renderer's document goes away (we pass a `@simple-dom/document` Document)

After the RFC ships in v8, the renderer always assumes interactive mode +
real DOM. Component lifecycle hooks always run during SSR. Modifiers
always run during SSR. simple-dom is no longer a supported document type
because the renderer will call `addEventListener`, `createDocumentFragment`,
etc. that simple-dom doesn't expose.

**Recommended replacement** (per the RFC text and per @NullVoxPopuli's
review on #21364): match the [`vite-ember-ssr`](https://github.com/evoactivity/vite-ember-ssr)
pattern — install happy-dom (or jsdom) on `globalThis`, render against it,
serialize via the Window's native `innerHTML`. happy-dom is what Bun's
own SSR docs recommend, what `vite-ember-ssr` uses, and what makes the
SSR environment indistinguishable from a browser. That last property is
the architectural goal — addons and library code stop needing
`if (typeof window !== 'undefined')` guards because every environment
the renderer runs in is browser-shaped.

**Direct effect on the adapter** (consolidated migration target for
Phase 1.5 or 1.6):

- Drop `hasDOM` and `isInteractive` from the `env` object passed to
  `renderComponent` in `src/build/compileEmber.ts`'s server harness.
- Switch `@simple-dom/document` to `happy-dom` for the SSR document.
- Drop `@simple-dom/document` and `@simple-dom/serializer` peer
  dependencies. happy-dom serializes via `documentElement.innerHTML`.
- Drop `installSimpleDomGlobals()` polyfill — happy-dom installs
  `Element`, `Node`, `Document`, etc. on its own `Window`; we promote
  those to `globalThis` for the duration of one render and restore
  afterwards (per-request isolation, per `vite-ember-ssr`).
- Both `EMBER_BANDAID #3` (Element polyfill) and `EMBER_BANDAID #4`
  (simple-dom serializer split) dissolve in this single migration — see
  [docs/EMBER_BANDAID.md](docs/EMBER_BANDAID.md).
- Document the new SSR semantics for users — lifecycle hooks and
  modifiers run during SSR; write SSR-safe hooks.

**What to watch for**:

- Implementation PR #21348 merging — that's when 7.x starts emitting
  deprecation warnings.
- Any 6.x patch that pre-emits the deprecation warnings (rare but
  Ember sometimes does this for advance notice).
- v8 release announcement — the actual removal point.

**Timeline**: v8 is ~12-18 months out at Ember's 18-month major cadence
from v7 (mid-2026). Our Phase 1 adapter ships against 6.12 LTS and
works fine on v7 with deprecation warnings. The migration is required
before v8.

**Why the change is right architecturally** (for our own posture, not
just Ember's): every other major UI framework already keeps the
"this is SSR" runtime question out of user code, just via different
mechanisms. React/Vue split it on lifecycle phases (effects don't run
on server). Svelte splits at compile time (component compiles twice;
runtime sees no difference). Angular wraps Domino internally so
`Element`/`Document` exist on the server the same as in the browser —
user code is environment-agnostic. Ember today is the only adapter in
our set that asks user code to know whether it's in SSR via the
`isInteractive` flag. The RFC's outcome puts Ember on Angular's branch
of that tree — there's a DOM, it just happens to be simulated, the
framework code doesn't care. From a meta-framework vantage, the RFC
takes Ember from outlier to consensus-aligned.

## 1. Reference adapters

When a question comes up like "how does X work for Ember?", the answer is
almost always "look at how Vue does it". The mapping is:

| Concern              | Closest reference adapter |
|----------------------|---------------------------|
| Component compile    | `compileVue.ts` / `compileSvelte.ts` |
| Vendor externalization | `buildVueVendor.ts` (HMR-runtime patching) |
| pageHandler shape    | `src/vue/pageHandler.ts` |
| Streaming wrap       | `src/vue/pageHandler.ts` (head/tail + primed body stream) |
| True streamed render | `src/svelte/renderToReadableStream.ts` |
| Islands (server)     | `src/vue/Island.ts` (`onServerPrefetch`) |
| Islands (browser)    | `src/vue/Island.browser.ts` |
| Composable / hook    | `src/vue/useIslandStore.ts` |
| HMR runtime patch    | Vue's `__VUE_HMR_RUNTIME__` guard + Angular's preserve-across-HMR |

Angular is the cautionary tale, not the model — only mirror it where Ember's
DI / partial-compile story forces it.

## 2. Surface area to build

### 2.1 Types (`types/`)

- [x] `types/ember.ts` — `EmberPageDefinition`, `EmberPagePropsOf<Page>`,
  `EmberPageHasOptionalProps<Page>`. Mirror `types/angular.ts` for shape, since
  both compile components separately from props. (Phase 1)
- [x] `types/island.ts` — extend the union: `IslandFramework = 'react' |
  'svelte' | 'vue' | 'angular' | 'ember'`. Add an `ExtractEmberProps<C>` arm.
  Glimmer components carry their args through the `Args` type parameter, so
  this is closer to Svelte's `ComponentProps` than React's prop inference.
  (Phase 1)
- [x] `types/conventions.ts` — add `ember?: FrameworkConventionEntry`. (Phase 1)
- [ ] `types/ember-shim.d.ts` — **probably not needed.** The shim's only
  job (see `vue-shim.d.ts` / `svelte-shim.d.ts`) is to teach TS that
  non-`.ts` extensions are importable. For Ember that would mean `*.gjs`
  / `*.gts` / `*.hbs`, but **Glint** (Ember's official TS toolchain for
  templates) already ships these module declarations. Default plan:
  document Glint as a peer requirement for Ember users and skip the shim.
  Only write one if users without Glint hit a real friction point.

### 2.2 Config (`src/utils/loadConfig.ts`, `defineConfig.ts`)

- [x] Add `emberDirectory` to the allow-list in `loadConfig.ts`. (Phase 1)
- [ ] No changes needed in `defineConfig.ts` — it's keyed off arbitrary
  service names; only the typed config sample in docs needs an example.

### 2.3 Build pipeline integration (`src/core/build.ts`)

**Status**: deferred to Phase 1.5. Phase 1 proved the pipeline by manually
calling `compileEmber()` and `buildEmberVendor()` from the example server.
The items below are the integration work — wiring the manual calls into
the central `build()` orchestrator so users get the standard
`defineConfig({ emberDirectory: '...' })` ergonomics.

This file is the biggest single touchpoint. Walk it framework-by-framework
and add the Ember equivalents alongside Svelte/Vue/Angular. Specifically:

- [ ] `validateSafePath(emberDirectory, projectRoot)` → `emberDir`.
- [ ] Derived paths: `emberPagesPath = join(emberDir, 'pages')`,
  potentially `emberIndexesPath` if we generate hydration indexes (see §3.2).
- [ ] `frameworkNames` array — push `'ember'` when `emberDir` is set.
- [ ] `sourceClientRoots` — include `emberDir`.
- [ ] `serverDirMap.push({ dir: emberDir, subdir: join('generated', 'server') })`.
- [ ] Convention scanner: `scanConventions(emberPagesPath, '*.{gjs,gts,ts}')`
  added to the `Promise.all` in build, with result stored as
  `emberConventionResult` and merged into `conventionsMap.ember`.
- [ ] `shouldCompileEmber = emberDir && emberEntries.length > 0` and the
  `compileEmber` invocation in the parallel `Promise.all` compile pass.
- [ ] Vendor build call: `buildEmberVendor(buildPath)` and
  `computeEmberVendorPaths()` exported via `src/core/devVendorPaths.ts`.
- [ ] Bundle pass — confirm Ember's compiled-to-JS output is plain ESM that
  Bun.build can pick up like Svelte's compiled output, so it joins the
  existing 4-pass bundle (server / react-client / non-react-client / islands)
  rather than adding a 5th pass.
- [ ] Glob extension list — include `gjs`, `gts`, `hbs` in the convention
  glob in `build.ts:285` (`'**/*.{ts,tsx,js,jsx,svelte,vue}'`).
- [ ] Telemetry: `'ember'` joins the `framework`/`frameworks` event payload.

### 2.4 Compile (`src/build/compileEmber.ts`)

**Status**: shipped in Phase 1 (~270 lines, simpler than the original
estimate because content-tag's `process()` does most of the heavy
lifting in WASM and the SSR-side bundle pass through `Bun.build` handles
transitive resolution via the resolver plugin).

Responsibilities:

- [x] Accept entries (gjs/gts/ts) and a target framework directory.
  (Phase 1)
- [x] Run Glimmer template compilation by calling `content-tag`
  directly inside the Bun pipeline — no Vite, no Embroider runtime.
  gjs/gts source files are split into JS + `template(...)` calls via
  `content-tag`'s WASM `Preprocessor.process()`, then the JS half is
  fed through `Bun.Transpiler` (with `experimentalDecorators: true` —
  see §0.1's stage-3 decorator note) and the SSR-side gets a full
  `Bun.build` pass with a resolver plugin that handles all
  `@ember/*`/`@glimmer/*`/`@simple-dom/*` transitive imports. We
  ended up not needing a direct `@glimmer/compiler` call — the
  template-compile happens at module-evaluation time via the
  vendored `@ember/template-compiler`. (Phase 1)
- [x] Produce **two** outputs per page: SSR module
  (`generated/server/<name>.js`, fully bundled) and client module
  (`generated/client/<name>.js`, transpiled-only — the framework's
  own client bundle pass picks it up later). (Phase 1)
- [ ] Mark pages that contain islands by setting
  `__ABSOLUTE_PAGE_HAS_ISLANDS__` on the compiled module. **Deferred
  to Phase 2** (islands aren't in Phase 1 scope).
- [ ] Emit deterministic relative paths so `generateManifest.ts`
  produces a hashed asset path. **Deferred to Phase 1.5** — Phase 1
  outputs to `<emberDir>/generated/{server,client}/<name>.js` with
  no hash; manifest integration happens with the build.ts wiring.
- [ ] Tailwind interop: emitted templates must be visible to the
  Tailwind scanner. Check `compileTailwindConfig` source list —
  `gjs/gts/hbs` should be added so utility class candidates inside
  `<template>` blocks survive. **Deferred to Phase 1.5**.

### 2.5 Vendor (`src/build/buildEmberVendor.ts`)

**Status**: shipped in Phase 1. Final specifier list ended up different
from the original guess because (a) `ember-source` doesn't expose a
`runtime` subpath in its `exports` map, and (b) Bun's @-prefix wildcard
resolver bug ([oven-sh/bun#30187](https://github.com/oven-sh/bun/issues/30187),
see EMBER_BANDAID #1) meant we couldn't import internal subpaths via
the bare specifier. The vendor build now uses a Bun.build resolver
plugin to route every `@ember/*`/`@glimmer/*`/`@simple-dom/*` resolution
to the absolute path inside `node_modules/ember-source/dist/packages/`.

Specifier list as actually shipped:
- `@ember/template-compiler` (vendored from inside ember-source — what
  content-tag's `process()` output imports)
- `@ember/renderer` (vendored from inside ember-source)
- `@glimmer/component` (standalone npm package)
- `@glimmer/tracking` (standalone npm package)
- `@embroider/macros` (virtualized via a Bun.build `onResolve`/`onLoad`
  plugin that serves a small shim — `@embroider/macros`'s real index
  throws by design because it expects compile-time replacement, see
  EMBER_BANDAID #2)

What changed vs the original plan:
- No `ember-source/runtime` (doesn't exist in 6.12's exports map).
- No `@ember/runloop` in the vendor set yet — Phase 1 pages don't use
  it. Add when a real example calls for it.
- No `@warp-drive/*` — Phase 1 doesn't ship a data layer.

- [x] Externalize the Ember runtime as stable vendor files at
  `{buildDir}/ember/vendor/`. (Phase 1)
- [x] Export `computeEmberVendorPaths()` for the dev module server.
  (Phase 1)
- [ ] Patch Glimmer's HMR runtime registration the same way we patch
  `__VUE_HMR_RUNTIME__`. **Deferred to Phase 3** (HMR scope).

### 2.6 SSR adapter (`src/ember/`)

**Status**: Phase 1 shipped a minimal `pageHandler.ts` + `index.ts` +
`server.ts` + `browser.ts`. Phase 2/3 features (streaming, slots,
islands, HMR-cache-dirty handling, convention rendering) are deferred.

Files shipped in Phase 1:
- `pageHandler.ts` (~120 lines) — `handleEmberPageRequest` dynamically
  imports the server bundle (compiled by `compileEmber`), calls its
  exported `renderToHTML(props)`, wraps the result in the standard
  `<head>` + `<body>` shell with the `__INITIAL_PROPS__` script.
  Auto-injects `request.url` pathname into props as `url` (matches the
  React/Svelte/Vue convention from the SPA work).
- `index.ts` / `server.ts` — re-exports.
- `browser.ts` — client mount via dynamic-import of `@ember/renderer`.

What changed vs the original plan:
- The handler is much simpler than the planned ~250 lines because the
  Phase 1 server bundle is self-contained (it embeds the renderer +
  simple-dom + serializer + page component into one file via
  Bun.build), so the handler doesn't have to dynamically import the
  renderer or set up a Document — it just calls the bundle's
  `renderToHTML`.
- No `renderToReadableStream.ts` yet. Phase 1 returns a complete
  HTML string, not a stream. Streaming is Phase 2.
- No `__ABSOLUTE_PAGE_HAS_ISLANDS__` detection. No island scaffolding.
  Phase 2.
- No streaming slot registrar wiring. Phase 2.
- No `isSsrCacheDirty('ember')` integration. Phase 1.5 with the
  build.ts wiring.
- No `renderConventionError('ember', …)` rendering — convention
  scaffolding stubs exist in `src/utils/resolveConvention.ts` returning
  null. Phase 1.5.

- [x] `pageHandler.ts` (Phase 1, minimal scope)
- [x] `server.ts` / `index.ts` (Phase 1)
- [x] `browser.ts` (Phase 1, minimal mount)
- [ ] `renderToReadableStream.ts` — Phase 2.
- [ ] `renderToString.ts` — sync wrapper for prerender. Phase 2 / SSG.
- [ ] Streaming primed-stream pattern. Phase 2.
- [ ] Island scaffolding + flag detection. Phase 2.
- [ ] Convention error rendering. Phase 1.5.

### 2.7 Streaming features

**Whole-page streaming.** Driven by `renderToReadableStream.ts` returning a
real `ReadableStream`. Elysia's perf wins (reuse of `Bun.serve`'s HTTP/2
streaming, automatic flushing) come from `Response(stream)`, so this is the
critical correctness item — **not** optional polish.

**Out-of-order streaming slots.** This already works framework-agnostically
through `src/core/streamingSlotRegistrar.ts` + `responseEnhancers.ts`. The
adapter work is just:

- [ ] `src/ember/components/StreamSlot.gts` — a Glimmer component that, at
  SSR time, calls `registerStreamingSlot` and renders the fallback HTML;
  client-side it's a no-op div with `data-absolute-slot="true"`. Match
  `src/vue/components/StreamSlot.ts` exactly for prop shape.
- [ ] `src/ember/components/SuspenseSlot.gts` — Glimmer wrapper over
  Glimmer's existing await-helper / `{{#await}}` block (Ember has resource
  primitives via `@warp-drive`'s request resource); produce the same
  collected-resolution pattern React/Svelte do.

**SSR cache dirty handling.** Add `'ember'` to whatever the discriminated
union in `src/core/ssrCache.ts` looks like (likely a string union) and a
matching `invalidateEmberSsrCache()` export from `src/ember/pageHandler.ts`
that the rebuildTrigger calls when an Ember source file changes.

### 2.8 Islands

Cross-framework islands are the marquee feature. Two directions matter:

1. **Ember islands hosted by other frameworks** — a React/Svelte/Vue/Angular/
   HTML page can `<Island framework="ember" component="…" />` and get a
   Glimmer component hydrated into a `<div>`.
2. **Ember pages hosting any island** — a `.gts` page can embed
   `<Island @framework="react" @component="Counter" @props={{...}} />` and
   get a React island.

Files to add:

- [ ] `src/ember/Island.ts` — server side. Mirrors `src/vue/Island.ts`. At
  SSR time call `renderIslandResult(requireCurrentIslandRegistry(), props)`
  inside an Ember resource so the result is awaited before the template
  renders. Glimmer doesn't have `onServerPrefetch`; the equivalent is to
  resolve the island in a `<template>`-level `await`-helper, OR to require
  islands be registered earlier in the request lifecycle and read
  synchronously here. Investigate (§3.4).
- [ ] `src/ember/Island.browser.ts` — preserves SSR markup, renders a
  `<div>` with `innerHTML` from `preserveIslandMarkup(props)`. Glimmer
  supports `{{{...}}}` triple-curly raw HTML, but for islands we want a
  marker-attribute div, not template injection.
- [ ] `src/ember/createIsland.ts` and `createIsland.browser.ts` — typed
  factory mirror of `src/vue/createIsland.ts`.
- [ ] `src/ember/islands.ts` (if Ember needs its own registry shim like
  Angular's `src/angular/islands.ts`) — only if Glimmer's DI surface is
  incompatible with the cross-framework registry. Default: skip; reuse
  `src/core/islands.ts`.
- [ ] `src/ember/lowerServerIslands.ts` — only if we add an Ember-template
  syntax sugar for islands (e.g. `<server-island>` element). Skip for v1.
- [ ] `src/ember/renderIsland.ts` and `Island.browser.ts` — entry-point
  shims used by `src/build/islandEntries.ts` to generate per-island client
  bundles. Confirm `islandEntries.ts` is data-driven enough that adding
  `'ember'` to the `IslandFramework` union plus a `src/ember/Island.browser`
  re-export gets us the wiring for free.

Update `types/island.ts` so the registry inference picks up Ember component
arg types correctly. Most likely shape: `ExtractEmberProps<C>` reads
`C extends Component<infer Args> ? Args['Args'] : never`.

### 2.9 Components (`src/ember/components/`)

Match the React/Vue surface. Each is a Glimmer component (`.gts`):

- [ ] `Image.gts` — wraps `imageOptimizer` plugin output; supports
  `responsive` / `eager` / `lazy` like the others.
- [ ] `Head.gts` — server-only head element collector. The React `<Head>`
  works via a context; for Ember the equivalent is a Glimmer component that
  emits into the SSR head buffer the page handler exposes.
- [ ] `JsonLd.gts` — emits a `<script type="application/ld+json">` tag.
- [ ] `StreamSlot.gts` — see §2.7.
- [ ] `SuspenseSlot.gts` — see §2.7.
- [ ] `index.ts` — re-exports.

### 2.10 Composables / services (`src/ember/`)

- [ ] `useIslandStore.ts` — Glimmer-friendly wrapper. Glimmer-tracked state
  re-renders on mutation; the wrapper should subscribe to a zustand vanilla
  store via `subscribeIslandStore` and expose a tracked getter. Reference
  shape: `src/vue/useIslandStore.ts` — Vue's `customRef` model maps cleanly
  onto Glimmer's `@tracked` + `notifyPropertyChange`.
- [ ] `useMediaQuery.ts` — parity with `src/react/hooks/useMediaQuery.ts`.

### 2.11 Conventions (error / loading / not-found)

`scanConventions` already understands the file-name pattern. The only
adapter-specific work:

- [ ] `resolveErrorConventionPath('ember', pageName)` and
  `hasErrorConvention('ember')` need an entry in
  `src/utils/resolveConvention.ts` (extension list and import strategy).
- [ ] Decide whether to also bridge to Ember's native router error/loading
  routes. v1: no — keep the AbsoluteJS conventions authoritative, since
  router-driven routes assume a single Ember app, not per-page Ember
  modules.

### 2.12 Dev / HMR

This is the second-biggest work item after compile. References:
`src/dev/moduleServer.ts`, `transformCache.ts`, `rebuildTrigger.ts`,
`webSocket.ts`, `dependencyGraph.ts`, and `src/dev/client/`.

- [ ] `moduleServer.ts` — add per-file Ember transpilation. For `.gts`/`.gjs`
  this is Glimmer template compilation followed by ESM emit; for `.ts` in
  the Ember dir it's just `Bun.Transpiler` like Angular.
- [ ] `transformCache.ts` — ensure mtime + version invalidation works for
  the new extensions (likely already fine — keyed on absolute path).
- [ ] `rebuildTrigger.ts` — register Ember as a framework in the dirty-check
  switch. Per the project memory note about `rebuildTrigger.ts`, **the
  Ember import here must be dynamic (`await import(...)`)** — static imports
  break HMR.
- [ ] `dev/client/` — patch the framework-detection + DOM-diff layer. Ember
  has its own component lifecycle and `setComponentTemplate` registration;
  for HMR we need the equivalent of Vue's `__VUE_HMR_RUNTIME__.rerender()`.
  Investigate Glimmer's HMR hook surface (§3.3).
- [ ] `preserveAcrossHmr.ts` (Ember edition) — Glimmer instances need state
  preserved across module reloads, similar to Angular. Follow
  `src/angular/preserveAcrossHmr.ts` as the model. Lower priority than
  rerender — for v1 we accept full remount on HMR.
- [ ] `prepare.ts` — pre-warm the Ember/Glimmer compiler the same way
  `compileSvelte` is JIT-warmed. Ember's compiler is heavy; warming matters.

### 2.13 CLI / index re-exports / index.ts side-effects

- [ ] `src/build/index.ts` exports `compileEmber`, `buildEmberVendor`,
  `computeEmberVendorPaths`.
- [ ] `src/index.ts` does NOT need an Ember side-effect import unless we
  end up patching a Glimmer global (parallel to the Angular
  `injectorPatch`). Decision deferred until the vendor patch is implemented.
- [ ] `src/cli/index.ts` — `absolute info` should report Ember presence.
- [ ] `src/cli/scripts/...` — no new commands needed; existing `dev`,
  `build`, `start`, `compile` subsume Ember.

### 2.14 Plugins (`src/plugins/`)

- [ ] `pageRouter` plugin — confirm its dispatcher branches on
  `IslandFramework` for response-type decisions; if so, add an Ember branch.
- [ ] `hmr` plugin — add Ember to its file-glob watcher.
- [ ] `imageOptimizer`, `networking`, `devtoolsJson` — framework-agnostic;
  no changes.

### 2.15 Example app

- [ ] `example/ember/pages/index.gts` — bare hello-world page with props.
- [ ] `example/ember/pages/with-island.gts` — page hosting a React island
  to prove cross-framework hydration.
- [ ] `example/react/pages/with-ember-island.tsx` — inverse, to prove a
  React page can host an Ember island.
- [ ] `example/ember/pages/streaming.gts` — exercise StreamSlot for
  out-of-order streaming.
- [ ] Update `example/index.ts` server config to register the Ember dir.

## 3. Open research items

These are questions whose answers shape the build, not just the
implementation. Resolve before starting §2.4.

### 3.1 Glimmer compile strategy

`renderComponent()` requires the page to be compiled by Glimmer. There is
only one viable approach for AbsoluteJS — Vite is not on the table.

**Library-mode Bun compile.** Invoke `@glimmer/compiler` and `content-tag`
directly inside `compileEmber.ts`, then bundle with `Bun.build`. Matches
how `compileSvelte.ts` calls `svelte/compiler` and `compileVue.ts` calls
`@vue/compiler-sfc`. Total control, fits the existing parallel pipeline,
no second build system. The cost we are paying for this is reimplementing
the parts of Embroider's Vite plugin that handle template-tag
(`<template>`) extraction and `setComponentTemplate` association — gjs/gts
files contain both JS and Handlebars and need a preprocessor.

The preprocessor itself is a thin wrapper over `content-tag`'s WASM
extractor (a small Rust crate, zero JS-runtime dependencies — fine to ship
inside a Bun pipeline). If the wrapper grows past ~300 lines that's the
signal the design has gone wrong — revisit before merging, but the
fallback is **not** to add Vite, it's to vendor more of the gjs parsing
logic.

### 3.2 Hydration index files

React generates hydration index files (`generateReactIndexFiles`). Vue and
Svelte do not — their compiled client modules already contain a
self-mounting bootstrap. Glimmer has a `renderComponent` client equivalent
(or close to it via `setComponentTemplate` + `mount`); check whether
emitting a per-page client bootstrap inline avoids the need for an
`emberIndexesPath`. **Tentative**: skip the indexes layer for Ember and
emit self-mounting client modules.

### 3.3 Glimmer HMR hooks

The single most uncertain item. Glimmer doesn't ship a documented HMR
runtime the way Vue does. Investigation tasks:

- Read `@glimmer/runtime` post-monorepo-merger for any `accept` / `swap`
  hooks added since the merge.
- Read Embroider's Vite HMR plugin source as a *reference* — it implements
  module-swap for the dev experience and is the closest published example
  of Glimmer-aware HMR. We don't run it; we crib the symbol-level approach
  and reimplement against `src/dev/moduleServer.ts` and our WebSocket-driven
  HMR client.
- Decide between (a) component-level rerender (preferred, fast), (b)
  page-level remount (acceptable v1 fallback), (c) full reload (last
  resort).

### 3.4 Async island resolution in Glimmer SSR

Vue uses `onServerPrefetch` to await island resolution before render.
Glimmer's analogous primitive needs to be confirmed. Candidates:

- `@glimmer/component`'s constructor + `await` in a tracked resource, used
  by `<template>`-level `{{#each}}` over a resource array.
- `renderComponent`'s second-pass pattern (render once, collect promises,
  await, render again) — slow but bulletproof.
- A pre-render pass that walks the template AST for `<Island>` usage and
  resolves before `renderComponent` runs at all.

### 3.5 WarpDrive vs ember-data

Pages that fetch data shouldn't care which one ships, but our docs and
example need to pick one. v1: don't ship a data-layer convention — let
users wire their own provider via Glimmer services.

## 4. Phased rollout

Cut three PRs. Each phase is independently shippable and gated by an
internal feature flag so the framework list export stays stable until
everything lands.

**Phase 1 — Pages-only SSR (no islands, no streaming, no HMR).**
§2.1, §2.2, §2.3 (minimum), §2.4, §2.5, §2.6 (`pageHandler.ts`,
`renderToString.ts`, `browser.ts`, `index.ts`), §2.11. Ship a hello-world
example. Goal: prove `renderComponent` round-trips through Bun + Elysia.

**Phase 2 — Streaming + islands.**
§2.6 (`renderToReadableStream.ts`), §2.7, §2.8, §2.9. Add the
cross-framework island example. Goal: parity with Vue.

**Phase 3 — Dev-mode HMR.**
§2.12 in full. Resolve §3.3 first. Goal: parity with Svelte/Vue HMR
(<50ms per-component rerender if the Glimmer hooks cooperate; full remount
otherwise).

## 5. Risks

- **Glimmer HMR turns out to require a vendor patch** (parallel to the Vue
  HMR-runtime guard). Mitigation: budget 1–2 days for vendor patching;
  fall back to remount-per-change for v1 if blocked.
- **gjs/gts preprocessor scope creep.** Mitigation: lift `content-tag`
  WASM rather than reimplement.
- **Ember 7.0 deprecation removals** land mid-build. Mitigation: see §0.1 —
  stay on 6.12 LTS, audit once at end of phase 2.
- **Audience size.** Ember community is smaller than the others; the
  payback per hour of work is lower. Mitigation: phase 1 is small enough
  that the spike is worth it regardless.

## 6. Success criteria

Ember reaches "staple framework" status when:

- A user can `defineConfig({ emberDirectory: 'ember' })` and serve
  `ember/pages/*.gts` with SSR.
- An Ember page can host React/Svelte/Vue/Angular islands, and a
  React/Svelte/Vue/Angular page can host an Ember island.
- `<StreamSlot>` works inside an Ember page.
- HMR rerenders an Ember component in under 100ms P50 in the example
  app (or, if Glimmer HMR isn't workable, full-page reload completes in
  under 300ms — explicitly documented as the v1 floor).
- `bun run typecheck`, `bun run lint`, and the existing example test
  suite stay green with the Ember adapter compiled in.

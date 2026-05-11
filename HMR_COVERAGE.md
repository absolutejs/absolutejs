# HMR caveat coverage

What's been verified end-to-end, with a link to the runnable test
for each row. Rows without a `tests/integration/hmr/...` link mark
real gaps in test coverage (not gaps in the implementation — the
behavior has been verified by hand against the dev runtime).

## Frameworks not yet covered

- **React** — explicitly skipped. React HMR doesn't work
  end-to-end because [oven-sh/bun#28312](https://github.com/oven-sh/bun/pull/28312)
  (the `reactFastRefresh` option on `Bun.Transpiler`) hasn't
  merged. Without per-component `$RefreshReg$` / `$RefreshSig$`
  injection, React module swaps fall back to a full reload
  instead of a state-preserving refresh — so any "HMR works"
  claim against React in this repo would be testing the wrong
  path. **Once #28312 ships and we wire it through
  `moduleServer.ts`'s React transpile, re-run every row of this
  matrix against React for parity.** See `REACT_TRANSPILER_BUG.md`.
- **Ember** — Phase 1 shipped (`EMBER_PLAN.md`); HMR layering is
  a later phase. **Once Ember reaches feature parity with the
  other adapters, re-run every row of this matrix against Ember.**
  See `EMBER_PLAN.md`, `EMBER_BANDAID.md`.

How to run any test below:

```sh
bun test tests/integration/hmr/lifecycle/cold-start.test.ts
# or by directory
bun test tests/integration/hmr/frameworks
# or the full HMR suite
bun test tests/integration/hmr
```

---

## Universal — applies to all framework adapters

| Scenario | Test |
|---|---|
| Fresh server start, WS handshake, manifest broadcast | [`lifecycle/cold-start.test.ts`](tests/integration/hmr/lifecycle/cold-start.test.ts) |
| WS reconnect after socket close; manifest re-broadcast; stale client cleanup | [`lifecycle/reconnect.test.ts`](tests/integration/hmr/lifecycle/reconnect.test.ts) |
| First file change after cold start triggers rebuild | [`lifecycle/first-change.test.ts`](tests/integration/hmr/lifecycle/first-change.test.ts) |
| Subsequent edits use warm cache | [`lifecycle/warm-change.test.ts`](tests/integration/hmr/lifecycle/warm-change.test.ts) |
| Rapid edits batch into a single rebuild via debounce | [`lifecycle/rapid-changes.test.ts`](tests/integration/hmr/lifecycle/rapid-changes.test.ts) |
| `absolute.config.ts` framework-dir add/remove restart pathway | [`lifecycle/config-change.test.ts`](tests/integration/hmr/lifecycle/config-change.test.ts) |
| Recovery after invalid markup edit | [`lifecycle/error-recovery.test.ts`](tests/integration/hmr/lifecycle/error-recovery.test.ts) |
| Cross-framework edits to two frameworks in one save | [`multiframework/simultaneous-change.test.ts`](tests/integration/hmr/multiframework/simultaneous-change.test.ts) |
| Asset hashing — manifest entries update after file change | [`assets/asset-hashing.test.ts`](tests/integration/hmr/assets/asset-hashing.test.ts) |
| CSS file change triggers rebuild | [`assets/css-hmr.test.ts`](tests/integration/hmr/assets/css-hmr.test.ts) |
| **In-flight request finishes with original handler after Path B reload** | [`lifecycle/in-flight-survival.test.ts`](tests/integration/hmr/lifecycle/in-flight-survival.test.ts) |
| **Module-level state on `globalThis` survives entry reload** | [`lifecycle/module-state-survival.test.ts`](tests/integration/hmr/lifecycle/module-state-survival.test.ts) |
| **Elysia `app.store` (incl. scopedState) preserved across Path B reload** | [`lifecycle/app-store-preservation.test.ts`](tests/integration/hmr/lifecycle/app-store-preservation.test.ts) |
| **Tier-0 surgical Angular/Svelte/Vue edit makes SSR catch up after debounce** | [`lifecycle/tier-zero-ssr.test.ts`](tests/integration/hmr/lifecycle/tier-zero-ssr.test.ts) |
| **Dep-graph reverse-link re-established after file delete + recreate** | [`lifecycle/dep-graph-recreate.test.ts`](tests/integration/hmr/lifecycle/dep-graph-recreate.test.ts) |
| Non-applicable `absolute.config.ts` change emits `[abs:restart]` marker for parent CLI to respawn | [`lifecycle/restart-fallback.test.ts`](tests/integration/hmr/lifecycle/restart-fallback.test.ts) |
| `dev.watchDirs` extra paths fire HMR | [`lifecycle/dev-watch-dirs.test.ts`](tests/integration/hmr/lifecycle/dev-watch-dirs.test.ts) |
| `collectStreamingSlots: true` silences the streaming-slot warning | [`lifecycle/streaming-slots-warning.test.ts`](tests/integration/hmr/lifecycle/streaming-slots-warning.test.ts) |
| Tailwind auto-injects `@source` directives for every configured framework dir | [`lifecycle/tailwind-class-discovery.test.ts`](tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts) (the per-framework subtests pass only if `@source` for each dir is auto-injected) |
| Tailwind incremental regen picks up new utility classes from HTML/HTMX page edits | [`lifecycle/tailwind-class-discovery.test.ts`](tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts) (HTML / HTMX subtests) |
| HTML/HTMX `<link rel="stylesheet" href="/assets/...">` (absolute path) passes through the rewriter unchanged | [`lifecycle/asset-href-passthrough.test.ts`](tests/integration/hmr/lifecycle/asset-href-passthrough.test.ts) |
| Multi-tab WebSocket broadcast — independent manifests per client | covered as part of [`lifecycle/cold-start.test.ts`](tests/integration/hmr/lifecycle/cold-start.test.ts) ("second client receives independent manifest") |
| Path A → restart fallback: in-place framework-dir change emits `[abs:restart]` | [`lifecycle/restart-fallback.test.ts`](tests/integration/hmr/lifecycle/restart-fallback.test.ts) ("framework-dir rename emits [abs:restart] with \"removed framework(s)\" log") |
| New page entry mid-session falls through to `[abs:restart]` | [`lifecycle/new-page-restart.test.ts`](tests/integration/hmr/lifecycle/new-page-restart.test.ts) |

---

## Angular

### Baseline HMR

| Scenario | Test |
|---|---|
| Page change broadcasts `angular-update` | [`frameworks/angular-hmr.test.ts`](tests/integration/hmr/frameworks/angular-hmr.test.ts) ("angular page change triggers angular-update") |
| Update message contains framework metadata | [`frameworks/angular-hmr.test.ts`](tests/integration/hmr/frameworks/angular-hmr.test.ts) ("update message contains framework data") |
| Child component change triggers update | [`frameworks/angular-hmr.test.ts`](tests/integration/hmr/frameworks/angular-hmr.test.ts) + [`components/component-hmr.test.ts`](tests/integration/hmr/components/component-hmr.test.ts) |
| Tier-0 surgical update → SSR catches up after debounce | [`lifecycle/tier-zero-ssr.test.ts`](tests/integration/hmr/lifecycle/tier-zero-ssr.test.ts) ("angular: SSR returns post-edit content after debounce") |
| Service (`.ts` in `angular/`) edits propagate to consuming component on every edit | [`lifecycle/dep-graph-recreate.test.ts`](tests/integration/hmr/lifecycle/dep-graph-recreate.test.ts) |
| Tailwind utility classes added to Angular templates land in `tailwind.generated.css` | [`lifecycle/tailwind-class-discovery.test.ts`](tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts) — `test.todo` (regen fires on disk; WS broadcast race tracked separately) |
| Template (`.html`) edits propagate | covered by tier-0 SSR test (edits `angular-example.html`) |

### Tier-decision matrix (`fastHmrCompiler.ts`'s fingerprint comparison)

| Edit shape | Expected tier | Test |
|---|---|---|
| Method body change (no decorator-arg change) | tier-0 surgical | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "method body change" |
| External `templateUrl` HTML edit | tier-0 surgical | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "external templateUrl HTML edit" |
| Field initializer value change (name set unchanged) | tier-0 surgical | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "field initializer value change" |
| Adding a new `@Input()` field | tier-1a remount | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "adding a new `@Input()` field" |
| `ChangeDetectionStrategy.OnPush` swap | tier-1a remount | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "switching `ChangeDetectionStrategy`" |
| `ViewEncapsulation.ShadowDom` swap | tier-1a remount | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "switching `encapsulation`" |
| Adding `host: { ... }` bindings | tier-1a remount | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "adding `host: {...}` bindings" |
| `imports: [...]` array mutation | tier-1b rebootstrap | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "mutating the `imports: [...]` array" |
| Adding component-level `providers` | tier-1b rebootstrap | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "adding component-level `providers`" |
| Adding `hostDirectives: []` | tier-1b rebootstrap | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "adding `hostDirectives: []`" |
| `routes` page-level export added/changed | tier-1b rebootstrap | [`lifecycle/angular-tiering.test.ts`](tests/integration/hmr/lifecycle/angular-tiering.test.ts) "editing a `routes` page-level export" |

### DI + injectables

| Scenario | Test |
|---|---|
| `@Component({ providers: [...] })` override changes SSR-rendered count | [`lifecycle/angular-di-injectables.test.ts`](tests/integration/hmr/lifecycle/angular-di-injectables.test.ts) "providers override" |
| Constructor body change reading `inject(TOKEN)` value | [`lifecycle/angular-di-injectables.test.ts`](tests/integration/hmr/lifecycle/angular-di-injectables.test.ts) "editing constructor body that reads from inject()" |
| Declaring + injecting a new `InjectionToken` flows through to SSR | [`lifecycle/angular-di-injectables.test.ts`](tests/integration/hmr/lifecycle/angular-di-injectables.test.ts) "declaring + injecting a new InjectionToken" |

### Modern template syntax (v17+)

| Scenario | Test |
|---|---|
| `@if` branch edit re-renders the chosen body | [`lifecycle/angular-modern-template.test.ts`](tests/integration/hmr/lifecycle/angular-modern-template.test.ts) |
| `@for` block edit renders every iteration | [`lifecycle/angular-modern-template.test.ts`](tests/integration/hmr/lifecycle/angular-modern-template.test.ts) |
| `@switch`/`@case` block picks matching case | [`lifecycle/angular-modern-template.test.ts`](tests/integration/hmr/lifecycle/angular-modern-template.test.ts) |
| `@defer` block ships the lowered placeholder body in SSR | [`lifecycle/angular-modern-template.test.ts`](tests/integration/hmr/lifecycle/angular-modern-template.test.ts) |
| `signal()` initial value change reaches SSR | [`lifecycle/angular-modern-template.test.ts`](tests/integration/hmr/lifecycle/angular-modern-template.test.ts) |
| `computed()` body change reaches SSR | [`lifecycle/angular-modern-template.test.ts`](tests/integration/hmr/lifecycle/angular-modern-template.test.ts) |

### External resources

| Scenario | Test |
|---|---|
| `styleUrl` (.css) edit reaches SSR inlined `<style ng-app-id>` block | [`lifecycle/angular-external-resources.test.ts`](tests/integration/hmr/lifecycle/angular-external-resources.test.ts) |
| `@import` chain inside a `styleUrl` propagates leaf changes | [`lifecycle/angular-external-resources.test.ts`](tests/integration/hmr/lifecycle/angular-external-resources.test.ts) |
| `styleUrl` deep edit (cascade-affecting selector) reaches SSR | [`lifecycle/angular-external-resources.test.ts`](tests/integration/hmr/lifecycle/angular-external-resources.test.ts) |
| `encapsulation: None` style edit propagates without `_ngcontent` rewrites | [`lifecycle/angular-external-resources.test.ts`](tests/integration/hmr/lifecycle/angular-external-resources.test.ts) |
| Inline `styles: [...]` array edit reaches SSR | [`lifecycle/angular-external-resources.test.ts`](tests/integration/hmr/lifecycle/angular-external-resources.test.ts) |

### Multi-file edits

| Scenario | Test |
|---|---|
| Editing leaf template propagates to /angular page SSR | [`lifecycle/angular-multifile.test.ts`](tests/integration/hmr/lifecycle/angular-multifile.test.ts) "editing counter template (child)" |
| Editing parent while child untouched still re-renders subtree | [`lifecycle/angular-multifile.test.ts`](tests/integration/hmr/lifecycle/angular-multifile.test.ts) "editing parent (app.component)" |
| First-edit fingerprint priming (no prior baseline) picks correct tier | [`lifecycle/angular-multifile.test.ts`](tests/integration/hmr/lifecycle/angular-multifile.test.ts) "first edit (no prior fingerprint)" |
| Simultaneous edits to two different components both apply | [`lifecycle/angular-multifile.test.ts`](tests/integration/hmr/lifecycle/angular-multifile.test.ts) "simultaneous edits to two different components" |

### Vendor / SSR specifics

| Scenario | Test |
|---|---|
| Baseline SSR HTML carries Angular hydration markers (`<!--nghm-->`, `ng-version`, `ng-server-context`, `ngh`, `<script id="ng-state">`) | [`lifecycle/angular-vendor-ssr.test.ts`](tests/integration/hmr/lifecycle/angular-vendor-ssr.test.ts) "hydration markers" |
| Manifest exposes `AngularExample` / `AngularExampleIndex` / `AngularExampleCSS` (`.ssr.js` or `.js`) | [`lifecycle/angular-vendor-ssr.test.ts`](tests/integration/hmr/lifecycle/angular-vendor-ssr.test.ts) "manifest exposes AngularExample" |
| Template edit re-emits a fresh bundle; SSR reflects new bytes | [`lifecycle/angular-vendor-ssr.test.ts`](tests/integration/hmr/lifecycle/angular-vendor-ssr.test.ts) "editing a component template" |
| `__ABSOLUTE_PAGE_USES_LEGACY_ANIMATIONS__` set when page imports `@angular/animations` | [`lifecycle/angular-vendor-ssr.test.ts`](tests/integration/hmr/lifecycle/angular-vendor-ssr.test.ts) "legacy animations flag" |
| SSR HTML imports the page index bundle URL from the manifest | [`lifecycle/angular-vendor-ssr.test.ts`](tests/integration/hmr/lifecycle/angular-vendor-ssr.test.ts) "SSR HTML imports the page index" |

---

## Svelte

| Scenario | Test |
|---|---|
| Page change broadcasts `svelte-update` | [`frameworks/svelte-hmr.test.ts`](tests/integration/hmr/frameworks/svelte-hmr.test.ts) ("svelte page change triggers svelte-update") |
| Update message contains framework metadata | [`frameworks/svelte-hmr.test.ts`](tests/integration/hmr/frameworks/svelte-hmr.test.ts) |
| Fast path provides `pageModuleUrl` for unbundled ESM | [`frameworks/svelte-hmr.test.ts`](tests/integration/hmr/frameworks/svelte-hmr.test.ts) |
| Child component change triggers update | [`frameworks/svelte-hmr.test.ts`](tests/integration/hmr/frameworks/svelte-hmr.test.ts) + [`components/component-hmr.test.ts`](tests/integration/hmr/components/component-hmr.test.ts) |
| Tier-0 surgical update → SSR catches up after debounce | [`lifecycle/tier-zero-ssr.test.ts`](tests/integration/hmr/lifecycle/tier-zero-ssr.test.ts) |
| New component file + import in page → renders after rebuild | [`lifecycle/new-component-import.test.ts`](tests/integration/hmr/lifecycle/new-component-import.test.ts) |
| Page rename + import update → page recovers | [`lifecycle/page-component-rename.test.ts`](tests/integration/hmr/lifecycle/page-component-rename.test.ts) |
| Scoped style block edits propagate | [`lifecycle/scoped-style-edits.test.ts`](tests/integration/hmr/lifecycle/scoped-style-edits.test.ts) ("svelte scoped style edit lands in SSR HTML") |
| Composable (`.svelte.ts` / `.ts` inside `svelteDir/`) edit propagates to SSR | [`lifecycle/svelte-composable-ssr.test.ts`](tests/integration/hmr/lifecycle/svelte-composable-ssr.test.ts) |

---

## Vue

| Scenario | Test |
|---|---|
| Page change broadcasts `vue-update` | [`frameworks/vue-hmr.test.ts`](tests/integration/hmr/frameworks/vue-hmr.test.ts) ("vue page change triggers vue-update") |
| Update message contains framework metadata | [`frameworks/vue-hmr.test.ts`](tests/integration/hmr/frameworks/vue-hmr.test.ts) |
| Template-only `<template>` change is detected | [`frameworks/vue-hmr.test.ts`](tests/integration/hmr/frameworks/vue-hmr.test.ts) ("vue template-only change is detected") |
| Fast path provides `pageModuleUrl` | [`frameworks/vue-hmr.test.ts`](tests/integration/hmr/frameworks/vue-hmr.test.ts) |
| Child component change triggers update | [`frameworks/vue-hmr.test.ts`](tests/integration/hmr/frameworks/vue-hmr.test.ts) + [`components/component-hmr.test.ts`](tests/integration/hmr/components/component-hmr.test.ts) |
| Tier-0 surgical update → SSR catches up after debounce | [`lifecycle/tier-zero-ssr.test.ts`](tests/integration/hmr/lifecycle/tier-zero-ssr.test.ts) |
| Scoped `<style scoped>` block edits propagate | [`lifecycle/scoped-style-edits.test.ts`](tests/integration/hmr/lifecycle/scoped-style-edits.test.ts) ("vue scoped style edit lands in SSR HTML") |
| Composable (`.ts` inside `vueDir/`) edit propagates to SSR | [`lifecycle/vue-composable-ssr.test.ts`](tests/integration/hmr/lifecycle/vue-composable-ssr.test.ts) |

---

## HTML

| Scenario | Test |
|---|---|
| Page change broadcasts `html-update` | [`frameworks/html-hmr.test.ts`](tests/integration/hmr/frameworks/html-hmr.test.ts) ("html page change triggers html-update") |
| Update message contains framework metadata | [`frameworks/html-hmr.test.ts`](tests/integration/hmr/frameworks/html-hmr.test.ts) |
| Update payload contains body content with changes | [`frameworks/html-hmr.test.ts`](tests/integration/hmr/frameworks/html-hmr.test.ts) ("html update contains body content with changes") |
| Absolute `<link rel="stylesheet" href="/assets/...">` passes through asset rewriter unchanged | [`lifecycle/asset-href-passthrough.test.ts`](tests/integration/hmr/lifecycle/asset-href-passthrough.test.ts) ("HTML page keeps `/assets/ico/favicon.ico` href unchanged") |
| Tailwind class added to HTML markup lands in `tailwind.generated.css` | [`lifecycle/tailwind-class-discovery.test.ts`](tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts) ("HTML page edit lands a fresh utility…") |

---

## HTMX

| Scenario | Test |
|---|---|
| Page change broadcasts `htmx-update` | [`frameworks/htmx-hmr.test.ts`](tests/integration/hmr/frameworks/htmx-hmr.test.ts) ("htmx page change triggers htmx-update") |
| Update message contains framework metadata | [`frameworks/htmx-hmr.test.ts`](tests/integration/hmr/frameworks/htmx-hmr.test.ts) |
| Fragment endpoint edit propagates via Path B reload | [`lifecycle/htmx-fragment-path-b.test.ts`](tests/integration/hmr/lifecycle/htmx-fragment-path-b.test.ts) |
| `/htmx/htmx.min.js` is served from `htmxDirectory` | [`lifecycle/htmx-vendor-serving.test.ts`](tests/integration/hmr/lifecycle/htmx-vendor-serving.test.ts) |
| Tailwind class added to HTMX markup lands in `tailwind.generated.css` | [`lifecycle/tailwind-class-discovery.test.ts`](tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts) ("HTMX page edit lands a fresh utility…") |

---

## Open issues

- **Tasks #227 / #228 — RESOLVED.** Composable (`.ts` under
  `vueDir/` or `svelteDir/`) edits now propagate through SSR
  on every subsequent edit, not just the first. Three coupled
  fixes shipped:

  1. `compileVue` / `compileSvelte` persistent caches now
     disk-check the cached output paths before short-circuiting
     a recompile. An external cleanup (incremental build, manual
     wipe of `.absolutejs/generated`) used to leave the cache
     pointing at vanished intermediates; the next bundle pass
     would die on `Could not resolve "../components/Foo.js"`.
  2. Per-framework tier-0 bundle rebuilds (`runVueBundleRebuild`,
     `runSvelteBundleRebuild`) now mirror the multi-framework
     `commonAncestor` `serverRoot` / `serverOutDir` math from
     `core/build.ts`, so rebuild outputs land at the same path
     the manifest already points to (`build/<fw>/server/pages/...`
     under multi-fw mode).
  3. The Angular SSR loader applies an mtime cacheBuster to
     `.js` page modules in development so a post-rebuild
     `await import()` actually re-reads the file instead of
     returning Bun's cached module.

  Verified by [`lifecycle/tier-zero-ssr.test.ts`](tests/integration/hmr/lifecycle/tier-zero-ssr.test.ts)
  and [`lifecycle/vue-composable-ssr.test.ts`](tests/integration/hmr/lifecycle/vue-composable-ssr.test.ts).
- **Task #223 — Page basename collision across framework dirs.**
  `Page.html` in both `html/pages/` and `htmx/pages/` collide in
  the manifest under the same `Page` key. Whichever framework's
  pipeline ran last wins. Build-time warning would help; namespacing
  the key would be a breaking change.
- **Task #224 — `@elysiajs/static` ENOENT race under rapid HMR
  bursts.** When the hashed bundle path is mid-rename during a
  high-cadence edit storm, the static plugin's
  `generateETag` reads the previous hash and bubbles ENOENT
  through the request handler. Real users hit rarely; restart
  resolves.

---

## Coverage notes

Every row in the matrix above is backed by a real integration
test. There is one `test.todo` (Angular template Tailwind regen)
covering a known race between the WebSocket `style-update`
broadcast and an unrelated framework's afterEach restore landing
in the same watcher batch — the Tailwind regen itself fires on
disk; the WebSocket signal is what's flaky in test conditions.
The four other framework dirs (HTML / HTMX / Svelte / Vue) all
exercise the same `@source` auto-injection and
`isTailwindCandidate` plumbing, so any regression in those
mechanisms would surface in at least one of those four subtests.

Tests run against the real `example/` app via
`tests/helpers/devServer.ts`, which spawns `bun --hot example/server.ts`
and exposes deterministic completion signals
(`waitFor('<framework>-tier-zero-ssr-rebuild-complete')`,
`waitForOutput(/\[abs:restart\]/)`, etc.) so the suite avoids
sleep-based polling everywhere except where Bun's WebSocket
implementation forces it.

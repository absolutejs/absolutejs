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
| Tailwind utility classes added to Angular templates land in `tailwind.generated.css` | [`lifecycle/tailwind-class-discovery.test.ts`](tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts) ("Angular template edit lands a fresh utility…") |
| Template (`.html`) edits propagate | covered by tier-0 SSR test (edits `angular-example.html`) |
| Browser-side counter state survives a tier-0 template-only edit (`ɵɵreplaceMetadata`) | [`lifecycle/angular-state-preservation.test.ts`](tests/integration/hmr/lifecycle/angular-state-preservation.test.ts) |

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

### Baseline HMR

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
| Browser-side `$state` counter survives a template/runes-mode edit (`$.hmr` collect/restore) | [`lifecycle/svelte-state-preservation.test.ts`](tests/integration/hmr/lifecycle/svelte-state-preservation.test.ts) |

### Svelte 5 deep coverage (runes, control-flow, slots, context)

| Scenario | Test |
|---|---|
| `$state` rune initial value change reaches SSR | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| `$derived` rune recomputes on dependency change | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| `.svelte.ts` module body change propagates to importer | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| Composable shape change (new exported function) is consumed by importer | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| New `export let` prop consumed by parent | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| Named `<slot>` from a new child component renders parent content | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| `setContext` / `getContext` flows value ancestor → descendant | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| `{#if}` block renders truthy branch | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| `{#each}` block renders every iteration | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| `{#await}` resolved-branch body renders SSR-side | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| `<style>` block edit lands a fresh rule in SSR-inlined `<style>` | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |
| `on:click` handler edit round-trips through HMR + SSR | [`lifecycle/svelte-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deep-coverage.test.ts) |

### Svelte 5 deeper coverage (advanced runes + directives + module context)

| Scenario | Test |
|---|---|
| `$effect` declaration compiles + `$derived` updates reach SSR | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| `$bindable()` prop declaration round-trips | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| `{#snippet}` + `{@render}` renders snippet body | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| `<script context="module">` exports compile cleanly | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| `use:action` directive round-trips | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| `createEventDispatcher` declaration round-trips | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| `transition:` directive declaration compiles | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| `:global()` selector edit lands non-scoped rule in served CSS | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| Multi-style-block SFC edits both land in served CSS | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| `bind:value` directive round-trips | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| Edit re-emits a fresh hashed page bundle (index URL rotates) | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| SSR HTML carries `svelte-<hash>` scope class | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| SSR HTML preserves `id="__absolute_svelte_root__"` root marker | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| Editing a non-page component re-emits a fresh server bundle | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |
| Creating + importing a new `.svelte.ts` module mid-session propagates | [`lifecycle/svelte-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/svelte-deeper-coverage.test.ts) |

---

## Vue

### Baseline HMR

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
| Browser-side `ref()` counter survives a template edit (`__VUE_HMR_RUNTIME__.rerender`) | [`lifecycle/vue-state-preservation.test.ts`](tests/integration/hmr/lifecycle/vue-state-preservation.test.ts) |
| Page-exported `setupApp(app, ctx)` hook receives Vue app + ctx, provide/inject lands in SSR | [`lifecycle/vue-setup-app-hook.test.ts`](tests/integration/hmr/lifecycle/vue-setup-app-hook.test.ts) "setupApp injection lands in SSR HTML" |
| Editing the `setupApp` body propagates through HMR | [`lifecycle/vue-setup-app-hook.test.ts`](tests/integration/hmr/lifecycle/vue-setup-app-hook.test.ts) "setupApp body edit propagates through HMR" |

### Vue deep coverage (Composition API, slots, provide/inject)

| Scenario | Test |
|---|---|
| `ref()` initial value change reaches SSR | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| `computed()` body change reaches SSR | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| `reactive()` object property change reaches SSR | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| Composable body change propagates through importing `.vue` | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| Composable shape change (new return field) propagates | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| New prop on child component consumed by parent | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| Named `<slot>` from a new child component renders | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| `provide` / `inject` flows ancestor → descendant | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| `v-if` directive edit toggles which branch renders | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| `v-for` directive renders every iteration | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| `defineExpose` member surfaces no SSR errors | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |
| Scoped `<style>` edit hashes new `data-v-…` attribute into served CSS | [`lifecycle/vue-deep-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deep-coverage.test.ts) |

### Vue deeper coverage (HMR change-type, lifecycle, advanced templates, SSR)

| Scenario | Test |
|---|---|
| Template-only edit fires `vue-update` broadcast | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| Script edit fires Vue HMR cycle with forceReload semantics | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| `watch({ immediate: true })` callback runs server-side | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| `watchEffect` runs synchronously in `setup()` server-side | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| `defineEmits` round-trips through HMR + SSR | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| `defineModel` SSR-renders initial value | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| `v-show` toggles inline `display:none` based on predicate | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| `@event.modifier` handlers compile and SSR-render | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| Multi-style-block SFC (scoped + global) edits both land | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| Custom directive with `getSSRProps` renders SSR attributes | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| Teleport with `disabled` SSRs children at declared spot | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| `Suspense` resolves default slot SSR-side | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| `onServerPrefetch` is awaited and reaches SSR | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| Edit re-emits a fresh hashed page bundle (index URL rotates) | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |
| SSR HTML carries `data-v-…` scope ids for scoped style attribution | [`lifecycle/vue-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/vue-deeper-coverage.test.ts) |

---

## HTML

| Scenario | Test |
|---|---|
| Page change broadcasts `html-update` | [`frameworks/html-hmr.test.ts`](tests/integration/hmr/frameworks/html-hmr.test.ts) ("html page change triggers html-update") |
| Update message contains framework metadata | [`frameworks/html-hmr.test.ts`](tests/integration/hmr/frameworks/html-hmr.test.ts) |
| Update payload contains body content with changes | [`frameworks/html-hmr.test.ts`](tests/integration/hmr/frameworks/html-hmr.test.ts) ("html update contains body content with changes") |
| Absolute `<link rel="stylesheet" href="/assets/...">` passes through asset rewriter unchanged | [`lifecycle/asset-href-passthrough.test.ts`](tests/integration/hmr/lifecycle/asset-href-passthrough.test.ts) ("HTML page keeps `/assets/ico/favicon.ico` href unchanged") |
| Tailwind class added to HTML markup lands in `tailwind.generated.css` | [`lifecycle/tailwind-class-discovery.test.ts`](tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts) ("HTML page edit lands a fresh utility…") |

### HTML deeper coverage (asset rewriting + HMR injection)

| Scenario | Test |
|---|---|
| Relative `<link rel="stylesheet">` rewrites to manifest-hashed `/indexes/...` URL | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| Absolute `/assets/...` href passes through unchanged | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| HTML body edit propagates to SSR in one rebuild cycle | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| Multiple `<link>` / `<script>` tags all rewrite correctly | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| HMR client `<script data-hmr-client>` injected into served HTML | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| `TypescriptExample` compiled-scripts artifact lands in build output | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| Creating a new HTML page mid-session emits `[abs:restart]` | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| HMR injection survives a subsequent page edit | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| Manifest key for HTML page is the basename (no "Page" suffix) | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| CSS path rewrite preserves resolvability across rebuilds | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| `html-update` broadcast carries framework metadata + body content | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |
| `public/*` files are served at `/<filename>` (mirror) | [`lifecycle/html-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/html-deeper-coverage.test.ts) |

---

## HTMX

| Scenario | Test |
|---|---|
| Page change broadcasts `htmx-update` | [`frameworks/htmx-hmr.test.ts`](tests/integration/hmr/frameworks/htmx-hmr.test.ts) ("htmx page change triggers htmx-update") |
| Update message contains framework metadata | [`frameworks/htmx-hmr.test.ts`](tests/integration/hmr/frameworks/htmx-hmr.test.ts) |
| Fragment endpoint edit propagates via Path B reload | [`lifecycle/htmx-fragment-path-b.test.ts`](tests/integration/hmr/lifecycle/htmx-fragment-path-b.test.ts) |
| `/htmx/htmx.min.js` is served from `htmxDirectory` | [`lifecycle/htmx-vendor-serving.test.ts`](tests/integration/hmr/lifecycle/htmx-vendor-serving.test.ts) |
| Tailwind class added to HTMX markup lands in `tailwind.generated.css` | [`lifecycle/tailwind-class-discovery.test.ts`](tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts) ("HTMX page edit lands a fresh utility…") |
| Module-level `globalThis`-stashed counter survives an entry edit + Path B reload | [`lifecycle/htmx-state-preservation.test.ts`](tests/integration/hmr/lifecycle/htmx-state-preservation.test.ts) |

### HTMX deeper coverage (hx-* attributes + fragment endpoints)

| Scenario | Test |
|---|---|
| `hx-*` attributes round-trip through SSR unchanged | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| HTMX page edit fires `htmx-update` broadcast | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| HMR client injected with `__HMR_FRAMEWORK__="htmx"` | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| Fragment endpoint `hx-get` returns plain text body after edit | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| `hx-swap="outerHTML"` style payload round-trips | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| `hx-swap-oob` (out-of-band) markup round-trips | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| `/htmx/htmx.min.js` vendor served with non-empty JS payload | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| Multi-route mutation in one save applies atomically (Path B) | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| `htmx-update` broadcast contains edited body content | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| Manifest key for HTMX page is the basename (no "Page" suffix) | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| Absolute `/assets/...` and `/htmx/...` paths pass through unchanged | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |
| JSON-returning fragment endpoint survives Path B reload | [`lifecycle/htmx-deeper-coverage.test.ts`](tests/integration/hmr/lifecycle/htmx-deeper-coverage.test.ts) |

---

## Cross-cutting reliability

| Scenario | Test |
|---|---|
| Long-running session — 25 sequential Vue page edits all converge | [`lifecycle/cross-cutting-reliability.test.ts`](tests/integration/hmr/lifecycle/cross-cutting-reliability.test.ts) |
| Rapid concurrent edits converge on last-edit state | [`lifecycle/cross-cutting-reliability.test.ts`](tests/integration/hmr/lifecycle/cross-cutting-reliability.test.ts) |
| Build-error recovery — syntax error → fix → SSR recovers, dev server still healthy | [`lifecycle/cross-cutting-reliability.test.ts`](tests/integration/hmr/lifecycle/cross-cutting-reliability.test.ts) |
| HMR client disconnect → reconnect preserves server state | [`lifecycle/cross-cutting-reliability.test.ts`](tests/integration/hmr/lifecycle/cross-cutting-reliability.test.ts) |
| 10 Angular template edits don't corrupt or grow the manifest | [`lifecycle/cross-cutting-reliability.test.ts`](tests/integration/hmr/lifecycle/cross-cutting-reliability.test.ts) |
| `/@src/` module-server URL serves source files (not 404 from staticPlugin) | [`lifecycle/cross-cutting-reliability.test.ts`](tests/integration/hmr/lifecycle/cross-cutting-reliability.test.ts) |
| Same-basename pages in html/ + htmx/ fire collision warning at boot | [`lifecycle/manifest-key-collision.test.ts`](tests/integration/hmr/lifecycle/manifest-key-collision.test.ts) (#223) |
| Rapid HMR rebuilds never produce 5xx responses for current asset URLs | [`lifecycle/static-serving-race.test.ts`](tests/integration/hmr/lifecycle/static-serving-race.test.ts) (#224) |
| New page entry mid-session emits `[abs:restart]` for parent CLI | [`lifecycle/new-page-restart.test.ts`](tests/integration/hmr/lifecycle/new-page-restart.test.ts) (#226) |
| SCSS via Angular `styleUrl` — `$var` substitution lands in SSR-inlined `<style>` block | [`lifecycle/style-preprocessor-roundtrip.test.ts`](tests/integration/hmr/lifecycle/style-preprocessor-roundtrip.test.ts) "SCSS via Angular styleUrl" |
| Less via Vue `<style lang="less">` block — `@var` interpolation reaches served CSS | [`lifecycle/style-preprocessor-roundtrip.test.ts`](tests/integration/hmr/lifecycle/style-preprocessor-roundtrip.test.ts) "Less in Vue style block" |
| Stylus via Vue `<style lang="stylus">` block — indentation-based syntax reaches served CSS | [`lifecycle/style-preprocessor-roundtrip.test.ts`](tests/integration/hmr/lifecycle/style-preprocessor-roundtrip.test.ts) "Stylus in Vue style block" |
| tsconfig `compilerOptions.paths` alias for `.vue` composable resolves at compile time | [`lifecycle/typescript-path-aliases.test.ts`](tests/integration/hmr/lifecycle/typescript-path-aliases.test.ts) "aliased composable import resolves at compile time and SSR renders cleanly" |
| Editing the alias-importing `.vue` file still triggers HMR | [`lifecycle/typescript-path-aliases.test.ts`](tests/integration/hmr/lifecycle/typescript-path-aliases.test.ts) "editing the alias-imported `.vue` file (its own source) still triggers HMR" |
| bun#30449 stale-source workaround — serverEntry edit lands on the next request (not the cached entry record) | [`lifecycle/bun-entry-stale-source-workaround.test.ts`](tests/integration/hmr/lifecycle/bun-entry-stale-source-workaround.test.ts) |
| `isAtomicWriteTemp` filters editor tmp filenames (`.tmp`, `~`, `.#`, `.absolutejs-hmr-`, `sed<random>`, `4913`) so the watcher skips them | [`tests/unit/dev/atomic-write-temp-patterns.test.ts`](tests/unit/dev/atomic-write-temp-patterns.test.ts) (unit) |
| 20 concurrent `/vue` fetches across a tier-0 edit window never produce 5xx or empty bodies | [`lifecycle/ssr-mid-rebuild-race.test.ts`](tests/integration/hmr/lifecycle/ssr-mid-rebuild-race.test.ts) "20 concurrent /vue fetches" |
| 40 fetches across 4 rapid Svelte edits never produce 5xx or empty bodies | [`lifecycle/ssr-mid-rebuild-race.test.ts`](tests/integration/hmr/lifecycle/ssr-mid-rebuild-race.test.ts) "40 fetches across 4 rapid Svelte edits" |
| Dev-server RSS stays within 3× the warmed baseline across 100 Vue HMR cycles (Linux-only) | [`lifecycle/dev-server-memory-ratchet.test.ts`](tests/integration/hmr/lifecycle/dev-server-memory-ratchet.test.ts) |
| SSR error logging — thrown `Error` from a Vue SFC surfaces in dev-server stderr with a frame from the compiled SSR JS | [`lifecycle/sourcemap-stack-traces.test.ts`](tests/integration/hmr/lifecycle/sourcemap-stack-traces.test.ts) |
| Behavioral snapshot: natural `delete cache + await import` pattern on `bun --hot` after atomic-rename — currently returns fresh bytes (tripwire for the sibling-copy workaround's necessity) | [`lifecycle/bun-entry-natural-pattern-sentinel.test.ts`](tests/integration/hmr/lifecycle/bun-entry-natural-pattern-sentinel.test.ts) |

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
- **Angular path-alias `paths` config trips NG0203 at SSR.**
  `readTsconfigPathAliases` (compileAngular.ts) wires tsconfig
  paths into the Angular pipeline, but adding a `paths` entry
  for component imports causes Angular to resolve `@angular/core`
  along two paths; SSR throws NG0203. Vue alias path is
  unaffected and is the canonical contract test
  (`lifecycle/typescript-path-aliases.test.ts`). Separate fix needed
  for the Angular compile graph.
- **Less / Stylus via Angular `styleUrl` is async-only.**
  `compileStyleFileIfNeededSync` deliberately errors on
  Less/Stylus because their compilers expose only an async API
  and Angular's `styleUrl` resolution is sync. Vue's
  `<style lang="…">` path uses the async preprocessor pipeline
  and supports both
  (`lifecycle/style-preprocessor-roundtrip.test.ts`).
- **SCSS partial (`@use` / `@import`) leaf-edit propagation
  through Angular `styleUrl`.** The integration test verifies
  root SCSS-file edits land in SSR; deeper @use partial-graph
  reverse-link follow-through is not yet asserted end-to-end.
- **bun#30449 multi-cycle stability and sibling-unlink filter.**
  Tested for one edit cycle. Repeated entry edits picking up
  fresh bytes on each iteration, and the watcher never firing a
  self-fire HMR loop from the sibling unlink, are racy to assert
  black-box because they depend on Bun's atomic-write event
  ordering and the watcher's 100ms dedupe. The atomic-write
  filter regex itself is unit-tested
  (`tests/unit/dev/atomic-write-temp-patterns.test.ts`).
- **Vue SSR build output is emitted without sourcemaps.**
  When a Vue SFC throws during SSR, the dev runtime catches the
  error and renders `ssrErrorPage` to the browser, but the
  underlying stack frames in stderr point at the compiled
  `example/build/vue/server/pages/VueExample.<hash>.js` file
  (with that file's line numbers), not at the original `.vue`
  source. The compileVue pipeline doesn't emit inline
  sourcemaps and Bun's runtime can't thread back to the
  authored source. `lifecycle/sourcemap-stack-traces.test.ts`
  asserts the visibility contract (sentinel + frame format in
  stderr) and pins the current build-output frame shape as a
  snapshot; tighten it to require `VueExample.vue` once
  sourcemaps land. Same likely affects Svelte and Angular SSR
  pipelines — verified for Vue only.

---

## Coverage notes

Every row in the matrix above is backed by a real integration
test. There are no `test.todo` entries in the suite.

The Tailwind `style-update` broadcast that was previously flaky
under shared-server conditions now carries `data.cause` (the
filtered list of files whose edit triggered the regen), and
[`lifecycle/tailwind-class-discovery.test.ts`](tests/integration/hmr/lifecycle/tailwind-class-discovery.test.ts)
filters on it. Combined with per-test dev-server isolation, this
removes the race that previously forced the Angular subtest into
`test.todo`. The four other framework dirs (HTML / HTMX / Svelte
/ Vue) plus Angular all exercise the same `@source` auto-injection
and `isTailwindCandidate` plumbing.

Tests run against the real `example/` app via
`tests/helpers/devServer.ts`, which spawns `bun --hot example/server.ts`
and exposes deterministic completion signals
(`waitFor('<framework>-tier-zero-ssr-rebuild-complete')`,
`waitForOutput(/\[abs:restart\]/)`, content-cause-filtered
`style-update`, etc.) so the suite avoids sleep-based polling
everywhere.

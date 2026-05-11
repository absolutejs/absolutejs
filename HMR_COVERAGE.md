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
| Atomic-rename writes to root config files (`.env`, `tsconfig.json`, `package.json`) trigger child restart | _gap_ — verified manually; needs `tests/integration/hmr/lifecycle/atomic-rename-root.test.ts` |
| `dev.watchDirs` extra paths fire HMR | _gap_ — verified manually; needs `tests/integration/hmr/lifecycle/watch-dirs.test.ts` |
| `collectStreamingSlots: true` silences the DeferSlot warning | _gap_ — verified manually; needs `tests/integration/hmr/lifecycle/streaming-slots.test.ts` |
| Tailwind auto-injects `@source` directives for every configured framework dir | _gap_ — needs Tailwind fixture; verified manually |
| Tailwind incremental regen picks up new utility classes from HTML/HTMX page edits | _gap_ — needs Tailwind fixture; verified manually (fix shipped) |
| HTML/HTMX `<link rel="stylesheet" href="/assets/...">` (absolute path) passes through the rewriter unchanged | _gap_ — needs a build-time assertion test; verified manually (fix shipped) |
| Multi-tab WebSocket broadcast — independent manifests per client | covered as part of [`lifecycle/cold-start.test.ts`](tests/integration/hmr/lifecycle/cold-start.test.ts) ("second client receives independent manifest") |
| Path A → restart fallback: in-place framework-add emits `[abs:restart]` | _gap_ — verified manually; needs `tests/integration/hmr/lifecycle/framework-add-restart.test.ts` |
| New page entry mid-session falls through to `[abs:restart]` | _gap_ — verified manually; needs `tests/integration/hmr/lifecycle/new-page-restart.test.ts` |

---

## Angular

| Scenario | Test |
|---|---|
| Page change broadcasts `angular-update` | [`frameworks/angular-hmr.test.ts`](tests/integration/hmr/frameworks/angular-hmr.test.ts) ("angular page change triggers angular-update") |
| Update message contains framework metadata | [`frameworks/angular-hmr.test.ts`](tests/integration/hmr/frameworks/angular-hmr.test.ts) ("update message contains framework data") |
| Child component change triggers update | [`frameworks/angular-hmr.test.ts`](tests/integration/hmr/frameworks/angular-hmr.test.ts) ("child component change triggers update") + [`components/component-hmr.test.ts`](tests/integration/hmr/components/component-hmr.test.ts) ("angular child component change triggers angular-update") |
| Tier-0 surgical update → SSR catches up after debounce | [`lifecycle/tier-zero-ssr.test.ts`](tests/integration/hmr/lifecycle/tier-zero-ssr.test.ts) ("angular: SSR returns post-edit content after debounce") |
| Service (`.ts` in `angular/`) edits propagate to consuming component on every edit | [`lifecycle/dep-graph-recreate.test.ts`](tests/integration/hmr/lifecycle/dep-graph-recreate.test.ts) (uses `services/cycle-a.ts`) |
| Production `bun run build` succeeds with JSON imports from components | _gap_ — verified manually (fix shipped: `compileAngular.ts` AOT JSON copy) |
| Tailwind utility classes added to Angular templates land in `tailwind.generated.css` | _gap_ — needs Tailwind fixture; verified manually |
| Template (`.html`) edits propagate | covered indirectly via tier-0 SSR test (it edits `angular-example.html`) |

---

## Svelte

| Scenario | Test |
|---|---|
| Page change broadcasts `svelte-update` | [`frameworks/svelte-hmr.test.ts`](tests/integration/hmr/frameworks/svelte-hmr.test.ts) ("svelte page change triggers svelte-update") |
| Update message contains framework metadata | [`frameworks/svelte-hmr.test.ts`](tests/integration/hmr/frameworks/svelte-hmr.test.ts) |
| Fast path provides `pageModuleUrl` for unbundled ESM | [`frameworks/svelte-hmr.test.ts`](tests/integration/hmr/frameworks/svelte-hmr.test.ts) |
| Child component change triggers update | [`frameworks/svelte-hmr.test.ts`](tests/integration/hmr/frameworks/svelte-hmr.test.ts) + [`components/component-hmr.test.ts`](tests/integration/hmr/components/component-hmr.test.ts) |
| Tier-0 surgical update → SSR catches up after debounce | [`lifecycle/tier-zero-ssr.test.ts`](tests/integration/hmr/lifecycle/tier-zero-ssr.test.ts) |
| New component file + import in page → renders after rebuild | _gap_ — verified manually |
| Page rename + import update → page recovers | _gap_ — verified manually |
| Scoped style block edits propagate | _gap_ — verified manually |
| **Composable (`.ts` inside `svelteDir/`) edit — first edit propagates, subsequent edits stall** | **OPEN BUG — tracked under task #227.** Repro: edit a `.ts` file imported by `.svelte`, observe first edit reaches SSR, second+ edits don't. See _Open issues_ below. Needs `tests/integration/hmr/frameworks/svelte-composable.test.ts` (currently passing-on-first-edit, expected-fail-on-second). |
| Production `bun run build` + `bun run start` parity | _gap_ — verified manually |

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
| Scoped `<style scoped>` block edits propagate | _gap_ — verified manually |
| **Composable (`.ts` inside `vueDir/`) edit — first edit propagates, subsequent edits stall** | **OPEN BUG — tracked under task #227.** Same root cause as the Svelte composable issue. Needs `tests/integration/hmr/frameworks/vue-composable.test.ts`. |
| Production `bun run build` + `bun run start` parity | _gap_ — verified manually |

---

## HTML

| Scenario | Test |
|---|---|
| Page change broadcasts `html-update` | [`frameworks/html-hmr.test.ts`](tests/integration/hmr/frameworks/html-hmr.test.ts) ("html page change triggers html-update") |
| Update message contains framework metadata | [`frameworks/html-hmr.test.ts`](tests/integration/hmr/frameworks/html-hmr.test.ts) |
| Update payload contains body content with changes | [`frameworks/html-hmr.test.ts`](tests/integration/hmr/frameworks/html-hmr.test.ts) ("html update contains body content with changes") |
| Absolute `<link rel="stylesheet" href="/assets/...">` passes through asset rewriter unchanged | _gap_ — verified manually (fix shipped) |
| Tailwind class added to HTML markup lands in `tailwind.generated.css` | _gap_ — needs Tailwind fixture; verified manually (fix shipped) |
| Production `bun run build` + `bun run start` parity | _gap_ — verified manually |

---

## HTMX

| Scenario | Test |
|---|---|
| Page change broadcasts `htmx-update` | [`frameworks/htmx-hmr.test.ts`](tests/integration/hmr/frameworks/htmx-hmr.test.ts) ("htmx page change triggers htmx-update") |
| Update message contains framework metadata | [`frameworks/htmx-hmr.test.ts`](tests/integration/hmr/frameworks/htmx-hmr.test.ts) |
| Fragment endpoint edit propagates via Path B reload | _gap_ — verified manually (route-handler swap) |
| `/htmx/htmx.min.js` is served from `htmxDirectory` | _gap_ — verified manually |
| Tailwind class added to HTMX markup lands in `tailwind.generated.css` | _gap_ — needs Tailwind fixture; verified manually (fix shipped) |
| Production `bun run build` + `bun run start` parity | _gap_ — verified manually |

---

## Open issues

- **Task #227 — Svelte/Vue composable multi-edit stall.** Editing
  a `.ts` file imported by a `.svelte` or `.vue` page propagates
  the first edit only; subsequent edits stall. Three compounding
  root causes documented in `tasks/#227`: (1) framework-compile
  cache short-circuits on `.svelte`/`.vue` source byte-hash and
  misses transitive `.ts` dep changes; (2) Vue and Svelte
  pageHandlers do `await import(path)` without cache-bust, so
  Bun's import cache returns the cached module for that path —
  Angular's pageHandler uses a per-request `?t=N` cache-bust on
  the JIT output; (3) the new `scheduleVueBundleRebuild` writes
  the server bundle to `build/vue/pages/` but the initial
  multi-framework build puts it at `build/vue/server/pages/`
  under `commonAncestor` `serverRoot` math, so the SSR resolver
  never sees the scheduler's output.
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

## What "verified manually" rows leave open

For every _gap_ above, the user-visible behavior was confirmed
in the temporary `abs-hmr-caveats` harness across the F batch of
the 2026-05-10 caveat-verification session, with results
documented per-row in the task notes (`#214`..`#222`). The
behaviors are present in shipping `main`; what's missing is the
locked-in integration test. Writing those tests requires either:

- expanding `example/` with the relevant scaffolding (Tailwind
  config, additional pages, an `.env`), or
- adding a per-test fixture under `tests/fixtures/` and pointing
  `startDevServer` at it via the `serverEntry` / `configPath`
  options.

The latter is the cleaner direction; until then this doc is the
source of truth on which scenarios have been hand-verified.

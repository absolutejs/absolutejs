# HMR caveat coverage matrix

What's been verified end-to-end against each framework's HMR
pipeline. Filled in as we run the caveat harness; gaps are real
gaps in test coverage, not in the implementation.

**Frameworks excluded from coverage:**

- **React** — explicitly skipped. React HMR doesn't work end-to-end
  in absolutejs because [oven-sh/bun#28312](https://github.com/oven-sh/bun/pull/28312)
  (the `reactFastRefresh` option on `Bun.Transpiler`) hasn't merged.
  Without per-component `$RefreshReg$` / `$RefreshSig$` injection,
  React module swaps fall back to a full reload instead of a
  state-preserving refresh — so any "HMR works" claim against React
  in this repo would be testing the wrong path. Once #28312 ships
  and we wire it through `moduleServer.ts`'s React transpile path,
  re-run every row of this matrix against React. See
  `REACT_TRANSPILER_BUG.md`.
- **Ember** — Ember support is still mid-implementation (Phase 1
  shipped per `EMBER_PLAN.md`; HMR layering is a later phase). Once
  Ember reaches feature parity with the other adapters, re-run
  every row of this matrix against Ember. See `EMBER_PLAN.md`,
  `EMBER_BANDAID.md`.

## Matrix

Legend: ✅ verified PASS · ⚠ verified with caveat · ❌ FAIL (open
issue) · — n/a · ? not yet tested

| Scenario | Angular | Svelte | Vue | HTML | HTMX |
|---|:-:|:-:|:-:|:-:|:-:|
| Component edit propagates to SSR after debounce | ✅ #196 | ✅ #200 | ✅ #200 | ✅ E2 | ✅ E3 |
| New file create + import wires up | ✅ A1/F2 | ✅ F2 | ✅ F2 | ✅ F2 | ✅ F2 |
| File rename (with import update) recovers | ✅ A2/F3 | ✅ F3 | ✅ F3 | ✅ F3 | ✅ F3 |
| File delete + recreate auto-recovers | ⚠ A3/F4 (needs consumer touch) | ⚠ F4 (same) | ⚠ F4 (same) | ✅ F4 | ✅ F4 |
| Style file edit (.css/.scss/style block) | ✅ F5 | ✅ F5 | ✅ F5 | ✅ F5 (tailwind) | — |
| Template-only edit (.html / `<template>` / markup) | ✅ via A3-followup | ✅ F2 | ✅ F2 | — | — |
| Tailwind class added in component → CSS regen | ✅ F6 | ✅ F6 | ✅ F6 | ✅ F6 + fix | ✅ F6 + fix |
| JSON import edit propagates to consuming component | ✅ F7 | — | — | — | — |
| Add new page file + register route in server.ts | ⚠ F8 (needs restart) | ⚠ F8 | ⚠ F8 | ⚠ F8 | ⚠ F8 |
| Composable / shared util edit (cross-framework, outside fw dir) | ✅ E4 | ✅ E4 | ✅ E4 | — | — |
| Composable edit INSIDE framework dir (.ts imported by .svelte/.vue/component) | ✅ multi-edit | ⚠ #227 (first edit propagates, subsequent stall) | ⚠ #227 (same) | — | — |
| Long-poll request survives entry reload | ✅ C1 | — | — | — | — |
| Module-level state survives entry reload | ✅ C2 | — | — | — | — |
| Tier-0 SSR catches up after edit | ✅ #196 | ✅ #200 | ✅ #200 | — | — |
| Cross-framework navigation between routes | ✅ E2/E3 | ✅ E2/E3 | ✅ E2/E3 | ✅ E2 | ✅ E3 |
| Tailwind auto-source picks up framework dirs | ✅ B2 | ✅ B2 | ✅ B2 | ✅ B2 | ✅ B2 |
| `bun run start` prod-runtime parity | ✅ D1 | ✅ E7 | ✅ E7 | ✅ E7 | ✅ E7 |

## Universal scenarios (apply across all frameworks)

| Scenario | Status |
|---|:-:|
| `.env` edit triggers child restart (atomic-rename safe) | ✅ A4 |
| `package.json` edit triggers restart | ✅ A5 |
| `tsconfig.json` edit triggers restart | ✅ A6 |
| Route handler swap in server.ts (Path B reload) | ✅ B3 |
| `app.store` state preserved across Path B reload | ✅ #211 |
| `dev.watchDirs` extra paths fire HMR | ✅ E5 |
| Multi-tab WebSocket broadcast | ✅ E8 |
| Streaming SSR / `collectStreamingSlots` | ✅ E6 |
| Asset edits in `public/` / `assets/` | ✅ F10 |
| Adding a framework dir in-place (Path A → restart) | ✅ #197 |
| Path B reload preserves PID + sockets + in-flight reqs | ✅ Path B shipped |

## Known caveats (open issues)

- **#197 / #226** — adding a new framework directory or a new page
  entry mid-session needs a child restart for the manifest to
  include the new entry. The dev runtime auto-emits `[abs:restart]`
  on `Cannot find module` / `undefined manifest entry` from the
  entry-reload error path, so the user-visible behavior is a clean
  restart with the new entry compiled in.
- **#223** — page basenames must be unique across framework
  directories. Two pages named `Page.html` in `html/pages/` and
  `htmx/pages/` collide in the manifest. Build-time warning would
  be a friendly addition; namespaced keys would be a breaking
  change.
- **#224** — `@elysiajs/static`'s ENOENT can hang requests during
  rapid HMR bursts (hashed bundle path is mid-rename when the
  static plugin tries to read it). Real users hit this rarely;
  restart resolves.

## Open follow-ups

- F4 delete + recreate: for component-based frameworks
  (Svelte/Vue/Angular), the recreated file's content doesn't reach
  SSR until the consumer file gets a content edit too. The
  dependency-graph fix from A3 reconnected the reverse-link, but
  the framework's per-component HMR scheduler treats "file
  reappeared" as a no-op for the importer. Workaround: touch any
  importing file. Real fix: detect reappear-after-delete and
  schedule a rebuild of dependents.
- **#227 Composable HMR (.ts inside frameworkDir) — affects Svelte AND Vue:**
  edits to a `.ts` file imported by a `.svelte` or `.vue` page propagate the
  FIRST time only. Subsequent edits stall (SSR keeps serving the previous
  composable value). Angular is robust to multi-edit composable changes.

  Investigated for Vue: the dep graph correctly traces the .ts → .vue edge,
  `handleVueFastPath` routes the change through `handleVueModuleServerPath`,
  the Vue bundle scheduler fires. Two compounding root causes:
  1. The framework-compile cache (`vueSourceHashCache` / equivalent for
     Svelte) keys on `.vue`/`.svelte` source byte-hash and short-circuits when
     the consumer file's content is unchanged — even though a transitive .ts
     dep changed.
  2. `vue/pageHandler.ts` does `await import(path)` without a cache-buster.
     Even when the on-disk bundle gets a new hash, Bun's module cache returns
     the previously-imported module for that path. Angular's pageHandler
     uses a per-request `?t=N` cache-bust on the JIT output; Vue/Svelte
     don't (or don't do it consistently).
  3. In multi-framework projects, my newly-added `scheduleVueBundleRebuild`
     writes the server bundle to `build/vue/pages/` but the initial build
     puts it in `build/vue/server/pages/` (different `serverOutDir` math
     when multiple frameworks share `commonAncestor` as `serverRoot`). The
     SSR-resolver still reads from the initial-build path → never sees the
     scheduler's output.

  Proper fix needs:
  - Compile-cache invalidation triggered by transitive .ts edits, not just
    .vue/.svelte source byte changes.
  - Pageref cache-bust in Vue + Svelte pageHandlers analogous to Angular's.
  - Scheduler's serverOutDir alignment with the initial build path under
    `commonAncestor` multi-framework cases.
  Out of scope for the F batch — tracked under #227.

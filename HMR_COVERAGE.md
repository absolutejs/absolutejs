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

Legend: ✅ verified PASS · ❌ FAIL (open issue) · — n/a · ? not yet
tested

| Scenario | Angular | Svelte | Vue | HTML | HTMX |
|---|:-:|:-:|:-:|:-:|:-:|
| Component edit propagates to SSR after debounce | ✅ #196 | ✅ #200 | ✅ #200 | ✅ E2 | ✅ E3 |
| New file create + import wires up | ✅ A1 | ? | ? | ? | ? |
| File rename (with import update) recovers | ✅ A2 | ? | ? | ? | ? |
| File delete + recreate auto-recovers | ✅ A3 | ? | ? | ? | ? |
| Style file edit (.css/.scss/style block) | ? | ? | ? | ? | ? |
| Template-only edit (.html / `<template>` / markup) | ✅ via A3-followup | ? | ? | — | — |
| Tailwind class added in component → CSS regen | ? | ? | ? | ? | ? |
| JSON import edit propagates to consuming component | ? | — | — | — | — |
| Add new page file + register route in server.ts | ? | ? | ? | ? | ? |
| Composable / shared util edit | ✅ E4 (utils/format.ts cross-fw) | ✅ E4 | ? (Vue-specific composable) | — | — |
| Long-poll request survives entry reload | ✅ C1 | — | — | — | — |
| Module-level state survives entry reload | ✅ C2 | — | — | — | — |
| Tier-0 SSR catches up after edit | ✅ #196 | ✅ #200 | ✅ #200 | — | — |
| Cross-framework navigation between routes | ✅ E2/E3 | ✅ E2/E3 | ✅ E2/E3 | ✅ E2 | ✅ E3 |
| Tailwind auto-source picks up framework dirs | ✅ B2 | ✅ B2 | ✅ B2 | ? | ? |
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
| Asset edits in `public/` / `assets/` | ? |
| Adding a framework dir in-place (Path A → restart) | ✅ #197 |
| Path B reload preserves PID + sockets + in-flight reqs | ✅ Path B shipped |

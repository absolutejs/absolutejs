# Angular HMR — historical plan (closed)

This was the original Phase 1 / Phase 2 / Phase 3 working document
from the dealroom porting session (~May 2026) that scoped Angular
HMR for AbsoluteJS. Everything actionable in it has shipped or been
explicitly dropped. The current architecture is documented in
`SURGICAL_HMR.md`.

Status snapshot:

- **Phase 1 (correctness fixes)** — all done. SSR `@angular/core`
  pinning (§1.1), build-lock orphan detection (§1.2), child
  process-group cleanup + Vite-style port fallback (§1.3),
  `rewriteImports` ENOENT tolerance (§1.4), watcher positive-include
  list (§1.5). §1.6 was confirmed already covered by the existing
  dependency graph and dropped.
- **Phase 2 (state preservation)** — superseded by the surgical
  architecture in `SURGICAL_HMR.md`. The original §2.1–§2.5 plan
  ("per-edit-type routing", "service HMR", "template-only HMR",
  "style-only HMR", "module-evaluation pinning") was all subsumed
  by the `decideAngularTier` dispatcher: a single resource-index
  walk maps any TS/HTML/CSS edit to the affected component(s) and
  picks Tier 0 / 1a / 1b based on what changed structurally. No
  per-edit-type code path; one fast extractor handles the lot.
- **Phase 3 (polish)** — §3.1 (success toast) dropped: dev log is
  enough, no other framework does this. §3.2 (force-reload escape
  hatch) dropped: a normal browser refresh already does this. §3.3
  (per-component HMR opt-out via magic comment) dropped: too much
  magic for too little payoff. §3.4 (build-time SSR core uniqueness
  check) shipped as `src/build/verifyAngularCoreUniqueness.ts`.

For the production architecture, see `SURGICAL_HMR.md`. For per-PR
context on individual changes, see `git log`.

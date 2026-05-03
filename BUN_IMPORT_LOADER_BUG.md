# Upstream Issues

Tracked upstream bugs in tooling AbsoluteJS depends on, plus what (if anything)
to do when each lands. Each entry lists the symptom we hit, where we patched
on our side, and what changes once upstream is fixed.

## Bun — `import()` masks evaluation errors after first throw

**Tracking:** [oven-sh/bun#29791](https://github.com/oven-sh/bun/issues/29791)
**Status:** Fixed on main; awaiting release of Bun 1.3.14. Reproduces on
Bun 1.3.13 (latest stable as of filing). The WebKit module-loader rewrite
in [oven-sh/bun#29393](https://github.com/oven-sh/bun/pull/29393) (merged
2026-04-25, commit 73e8889f8c) addressed it; verified by robobun on Bun
1.3.14-canary.1+db12b449f. **Action when 1.3.14 ships:** see "What to do
when Bun fixes the loader" below.

### What's wrong upstream

When `await import(path)` evaluates a module whose top-level code throws,
the first import correctly rejects. The **second** sequential `import()` of
the same path returns a partially-initialized module record (e.g. `default:
undefined`) instead of re-throwing the original error, in violation of the
ESM spec. Node behaves correctly. See the linked issue for minimal repros.

### How it bit AbsoluteJS

`src/build/compileAngular.ts` used to derive the page-component class name
from the source filename: `${toPascal(fileBase)}Component`. When a user
page named e.g. `resources.ts` exported a class with a non-conforming name
like `ContentComponent`, the appended `export default ResourcesComponent;`
referenced an identifier that was never declared — a dangling reference in
the bundled output.

Bun's loader masking made this look like an HMR race instead of a hard
codegen bug: first request to that route 500'd with `ResourcesComponent is
not defined`; second and subsequent requests succeeded (with `default ===
undefined`, which the framework's `resolvePageComponent` fallback then
papered over by scanning named exports). End-to-end the symptom was
"first-hit flaky, retries pass" — easy to mistake for a rebuild race.

### What we did on our side

Patched `compileAngular.ts` in **beta.719** to parse the actual exported
class from the source (`detectExportedComponentClass`) instead of guessing
from the filename. The filename heuristic is preserved as a final
fallback so existing example projects whose names match the convention
keep working.

### What to do when Bun fixes the loader

**Nothing has to change.** The class-name detection is correct
regardless — it removes the trigger of the dangling-reference bundle
emit, not a workaround for Bun's caching behavior. The user-visible
difference is:

- Today: a sloppy bundle with a dangling reference 500s once then
  silently degrades. Easy to miss.
- Once fixed: the same bundle 500s on **every** request, surfacing the
  real bug immediately.

Optional follow-ups when the fix ships:

1. **Bump the minimum Bun version** (`engines.bun` in `package.json`) to
   the first release containing the fix, so anyone using AbsoluteJS gets
   the louder failure mode.
2. **Add a regression test** under `tests/` that loads a deliberately
   dangling page module twice and asserts the second `import()` rejects
   with the same error as the first. This catches both regressions of the
   class-name detection and any future loader regression in Bun.
3. **Refresh the in-code comment** in `compileAngular.ts` near
   `detectExportedComponentClass` to mention "this also surfaces loader
   regressions early" once the masking is gone.

No other code changes needed.

## Bun — `reactFastRefresh` ignored by `Bun.Transpiler`

**Tracking:** [oven-sh/bun#28312](https://github.com/oven-sh/bun/pull/28312)
**Status:** Open PR (not yet merged). The fix is implemented and
verified locally — applying the patch turns React Fast Refresh on for
AbsoluteJS's HMR pipeline. Until the PR lands, **this is the single
biggest thing blocking React HMR from working in AbsoluteJS** on
stock Bun: edits to a React component fall back to a full reload
instead of a state-preserving swap.

### What's wrong upstream

`new Bun.Transpiler({ reactFastRefresh: true })` silently ignores the
option on stock Bun. The transpiler emits the JSX/TS output without
injecting the `$RefreshReg$` / `$RefreshSig$` calls that React's
`react-refresh/runtime` needs to associate component instances with
their source modules. With no per-component registrations, swapping
a transpiled module at runtime cannot trigger a refresh — the runtime
has nothing registered against the new module's component identities,
so it can't reconcile state.

(`Bun.build` accepts the same option and the patched transpiler is
shared by both code paths, so once the PR merges both the initial
bundle and the dev module-server transpile pick it up.)

### How it bit AbsoluteJS

React HMR in AbsoluteJS uses a per-file transpile via `Bun.Transpiler`
in `src/dev/moduleServer.ts` (`transformReactFile`). Without
`$RefreshReg$` / `$RefreshSig$` injection, the per-file path serves
new module bytes on save but no component re-registers, so the
`react-refresh` runtime cannot perform a preserving update — the page
falls back to a full reload. Symptom: editing a React component while
`bun run dev` is up causes a flash and component state is lost,
instead of the in-place swap users expect.

### What we did on our side

- The transpiler is configured with `reactFastRefresh: true`, and
  `transformReactFile` already strips the
  `import { ... } from 'react-refresh/runtime'` that the patched
  transpiler generates (otherwise it would create a fresh runtime
  per module, distinct from the one the bundled index loaded), and
  rewrites the aliased `$RefreshReg$_xxxxxxxx` /
  `$RefreshSig$_xxxxxxxx` names to the shared
  `window.$RefreshReg$` / `window.$RefreshSig$` globals. This is the
  correct long-term shape — keep it after the PR merges.
- `moduleServer.ts` runs a probe at load time
  (`probeReactFastRefresh`): it constructs a transpiler with the
  option, transpiles a tiny component, and checks the output for
  `$RefreshReg$`. On the first React file transform, if the probe
  showed unsupported, a one-shot warning fires pointing at this PR
  and asking the user to leave a 👍 on it.
- Removed the dead "rebundle the affected react entries via
  `Bun.build()`" fallback in `src/dev/rebuildTrigger.ts`
  (`bundleReactClient`, `collectReactEntries`,
  `resolveReactEntryForFile`, `resolveReactEntriesFromDeps`,
  `resolveReactEntryForPageFile`). That branch also passed
  `reactFastRefresh: true` to `Bun.build`, so on stock Bun it would
  silently produce non-refreshable output and on patched Bun the
  per-file module-server path is strictly faster anyway. The
  remaining `handleReactFastPath` always routes through
  `handleReactModuleServerPath`.

### What to do when Bun merges PR #28312

1. **Bump the minimum Bun version** in `package.json` (`engines.bun`)
   to the first release that contains the merged PR. This guarantees
   the warning never fires for users on a supported Bun.
2. **Remove the probe + one-shot warning** in `moduleServer.ts`:
   `probeReactFastRefresh`, `reactFastRefreshSupported`,
   `reactFastRefreshWarningEmitted`,
   `warnIfReactFastRefreshUnsupported`, and the call site at the top
   of `transformReactFile`.
3. **Drop the local type intersection** if Bun publishes
   `reactFastRefresh` in `TranspilerOptions`. Today the option exists
   on `Bun.build`'s `BuildOptions` typings (see
   `node_modules/bun-types/bun.d.ts`) but **not** on
   `TranspilerOptions`, which is why `moduleServer.ts` declares
   `ReactTranspilerOptions` locally.
4. **Keep** the import-rewrite + global-rebind block inside
   `transformReactFile`. That code compensates for the patched
   transpiler's per-module `react-refresh/runtime` import and is the
   correct long-term shape — removing it would re-introduce the
   "two runtime instances, no registrations get matched" failure.
5. **Verify HMR end-to-end** with the example app: start `bun run
   dev`, edit a `useState` component, confirm state survives the
   edit (no reload, value persists). The warning should not appear
   in the dev server log.

Until then, AbsoluteJS users running stock Bun see the one-shot
warning the first time a React file is transpiled in dev mode, and
React edits trigger a full reload.

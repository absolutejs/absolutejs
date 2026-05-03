# Bun — `reactFastRefresh` ignored by `Bun.Transpiler`

**Tracking:** [oven-sh/bun#28312](https://github.com/oven-sh/bun/pull/28312)
**Status:** Open PR (not yet merged). The fix is implemented and
verified locally — applying the patch turns React Fast Refresh on for
AbsoluteJS's HMR pipeline. Until the PR lands, **this is the single
biggest thing blocking React HMR from working in AbsoluteJS** on
stock Bun: edits to a React component fall back to a full reload
instead of a state-preserving swap.

## What's wrong upstream

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

## How it bit AbsoluteJS

React HMR in AbsoluteJS uses a per-file transpile via `Bun.Transpiler`
in `src/dev/moduleServer.ts` (`transformReactFile`). Without
`$RefreshReg$` / `$RefreshSig$` injection, the per-file path serves
new module bytes on save but no component re-registers, so the
`react-refresh` runtime cannot perform a preserving update — the page
falls back to a full reload. Symptom: editing a React component while
`bun run dev` is up causes a flash and component state is lost,
instead of the in-place swap users expect.

## What we did on our side

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

## What to do when Bun merges PR #28312

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

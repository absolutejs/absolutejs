# Bun: `reactFastRefresh` ignored by `Bun.Transpiler`

**Tracking:** [oven-sh/bun#32919](https://github.com/oven-sh/bun/issues/32919) (open). The fix was
written in [oven-sh/bun#32951](https://github.com/oven-sh/bun/pull/32951) and closed unmerged as
stale; the earlier [#28312](https://github.com/oven-sh/bun/pull/28312) targeted files Bun has since
rewritten.
**Re-checked 2026-10-05:** still broken on Bun 1.4.2 (no `$RefreshReg$` in the transpiler's output).
Related open work that could land it: [#42010](https://github.com/oven-sh/bun/pull/42010) (one React
Fast Refresh contract for `.jsx` and `.tsx`, adds `reactFastRefresh.importSource`) and
[#40179](https://github.com/oven-sh/bun/issues/40179) (a `bun --hot` flag running the transform).
The patched build is now `1.4.2-absolute.1` (Bun 1.4.2 plus only this fix), pinned in `src/cli/patchedBun.ts`.
**Our answer:** AbsoluteJS publishes Bun with just that fix,
[absolutejs/patched-bun](https://github.com/absolutejs/patched-bun), for every platform Bun ships.

## What's wrong upstream

`new Bun.Transpiler({ reactFastRefresh: true })` silently ignores the option on stock Bun. The
transpiler emits JSX/TS without the `$RefreshReg$` / `$RefreshSig$` calls that
`react-refresh/runtime` needs to tie component instances to their modules, so swapping a module at
runtime cannot refresh in place. `Bun.build()` honors the option; only the per-file transpiler, which
`absolute dev` uses for HMR (`transformReactFile` in `src/dev/moduleServer.ts`), does not.

## How AbsoluteJS handles it

- **`absolute dev` offers the patched build** on stock Bun in React projects: Install now / Ask me
  later (asks again after a day) / Don't ask again. [bvm](https://github.com/absolutejs/bvm) (a
  dependency, `@absolutejs/bvm`) installs it after checking the release's `SHASUMS256.txt` against
  the AbsoluteJS release key's Ed25519 signature, so a new patched build needs no framework release to
  re-pin checksums. Only the dev server uses it; the user's `bun` is never touched (unless they opt in
  with bvm, e.g. a `.bun-version` of `1.4.2-absolute.1`). CI and non-interactive runs get one line
  instead of a prompt. `ABSOLUTE_PATCHED_BUN=0` always uses PATH's bun. Installs from releases before
  bvm (`~/.absolutejs/bun`) move onto bvm's copy on the next `absolute dev`.
- **`absolute bun-patch [status|install|remove|reset]`** manages it by hand.
- **On stock Bun** React edits fall back to a targeted page remount, and `moduleServer.ts` warns once
  on the first React edit, pointing at `absolute bun-patch install`.
- **PAAS** Studio images install the patched build with bvm, so workspaces always refresh in place.

The import rewrite in `transformReactFile` (dropping the transpiler's per-module
`react-refresh/runtime` import and binding the aliased `$RefreshReg$_xxxx` / `$RefreshSig$_xxxx`
names to the shared `window` globals) is **not** a workaround: it is the correct long-term shape
and stays after the fix ships. Without it each module would get its own runtime instance and no
registration would match.

## When a Bun release ships the fix

Every temporary piece is marked `BUN-REACT-REFRESH-LEGACY`; `grep -rn BUN-REACT-REFRESH-LEGACY src`
finds them all:

1. Raise `engines.bun` in `package.json` to the first release with the fix.
2. Delete `src/cli/patchedBun.ts`, the `bun-patch` command in `src/cli/index.ts`, and the runtime
   selection in `src/cli/scripts/dev.ts` (the dev server goes back to spawning `bun`).
3. In `src/dev/moduleServer.ts`, delete the probe, `isReactFastRefreshSupported`,
   `warnIfReactFastRefreshUnsupported`, and the local `ReactTranspilerOptions` type once Bun's
   typings declare `reactFastRefresh`.
4. In `src/dev/rebuildTrigger.ts`, drop the two support checks and the `fastRefreshSupported`
   argument; in `src/dev/client/handlers/react.ts` and `src/dev/client/hmrClient.ts`, drop the
   remount fallback and the `fastRefreshSupported` message field.
5. Stop releasing absolutejs/patched-bun, drop the `@absolutejs/bvm` dependency if nothing else
   uses it, and switch the PAAS Studio image back to Bun's official release.
6. Verify end to end: `bun run dev` on the example app, edit a `useState` component, and confirm the
   state survives with no reload and no warning.

# Limitation: in-place framework toggle in `absolute.config.ts`

**Status:** Works via full child restart (the dev CLI's project-root file
watcher catches the edit, kills the bun child, respawns it). True
in-place handling is not implemented.

## What works today

Editing `absolute.config.ts` to add or remove a framework directory
(e.g. `htmlDirectory: 'html'`, `reactDirectory: 'react'`,
`angularDirectory: 'angular'`, etc.) propagates correctly:

1. The dev CLI's `fs.watch(serverEntryDir)` block in
   `src/cli/scripts/dev.ts` fires on the edit.
2. `scheduleServerRestart` debounces to 80 ms, then SIGTERMs the bun
   child and respawns it.
3. The fresh child runs `prepare()` → `prepareDev()` → `devBuild()`
   with the new config. New framework runtime is fully initialized;
   removed framework's runtime is gone.

Verified with `htmlDirectory` add → remove → add cycles. Both add and
remove succeed across the restart.

The cost is the restart itself (~1–4 s warm rebuild for typical
projects), and any in-flight request / module-level state is lost.

## What doesn't work — true in-place toggle

Switching framework on/off without a process restart. The framework
already has the *additive* half of this wired:
`detectConfigChanges()` in `src/core/devBuild.ts` compares old vs new
`FRAMEWORK_DIR_KEYS`, sets vendor paths for newly-added frameworks
(React, Angular, Svelte, Vue, Ember), and starts file watchers for
the new directories. So adding a framework in-place is *almost*
implementable.

Two things missing:

1. **Trigger.** `detectConfigChanges` is currently only invoked from
   `handleCachedReload()` — which only runs on a Bun `--hot` reload of
   `server.ts`. Bun `--hot` is itself blocked by
   [oven-sh/bun#30436](https://github.com/oven-sh/bun/issues/30436)
   (see `BUN_HOT_WATCHER_BUG.md`), so this path never fires under our
   dev runtime. To enable in-place toggle, the dev server's internal
   `fileWatcher` would need to watch `absolute.config.ts` at the
   project root and call `detectConfigChanges` directly on change.

2. **Removal teardown.** `detectConfigChanges` only handles addition —
   if a user *removes* a framework dir from the config, the framework
   doesn't tear down the existing state. Removal requires:

   - Closing the recursive `fs.watch` instance(s) for that
     framework's directory (currently kept on `state.watchers`).
   - Unsetting vendor-path globals (e.g. `setAngularVendorPaths(null)`).
   - Clearing the framework's compiled artifacts under
     `.absolutejs/generated/<framework>/` so a later re-add doesn't
     pick up stale outputs.
   - Removing the framework's routes from the live Elysia app.
   - Possibly evicting cached transforms in the dev module server.

   None of that is wired today.

## Implementation sketch (when this gets prioritized)

1. In `src/dev/fileWatcher.ts` (or a new sibling), set up a watcher on
   `resolve(process.cwd(), 'absolute.config.ts')` (also handle
   atomic-rename — watch the dir, dispatch on filename match).
2. On change, await `loadConfig()` and call a new
   `applyConfigChange(cached, newConfig)` that wraps the existing
   `detectConfigChanges` plus a removal path.
3. The removal path: for each framework key now absent from the
   config, walk `state.watchers` to close the watcher, call the
   relevant `setXVendorPaths(null)`, and `rm -rf` the
   `.absolutejs/generated/<framework>/` directory.
4. For routes: Elysia doesn't have a stable "remove plugin" API, so
   removal of a framework's runtime routes likely still requires a
   restart. Adding a framework can be done via `app.use(...)` on the
   live instance; removal is the harder direction.

Until that lands, the workaround in `src/cli/scripts/dev.ts` —
project-root file watch + child restart — is the supported answer.

## Independent of the bun bug

This limitation is *independent of* `oven-sh/bun#30436`. Even if Bun
fixes `--hot`, `detectConfigChanges` still only handles addition and
still only fires on a server-entry hot reload (not on a dedicated
config-file watch). Both gaps need closing for true in-place toggle.

# Limitation: in-place framework toggle in `absolute.config.ts`

**Status:** Works via full child restart (the dev CLI's project-root file
watcher catches the edit, kills the bun child, respawns it). True
in-place handling is not implemented today, but **is implementable** —
see "Path forward" below.

## What works today

Editing `absolute.config.ts` to add or remove a framework directory
propagates correctly via the CLI restart pathway:

1. The dev CLI's `fs.watch(serverEntryDir)` block in
   `src/cli/scripts/dev.ts` fires on the edit.
2. `scheduleServerRestart` debounces 80 ms, then SIGTERMs the bun
   child and respawns it.
3. The fresh child runs `prepare()` → `prepareDev()` → `devBuild()`
   with the new config. New framework runtime is fully initialized;
   removed framework's runtime is gone.

Cost: ~1–4 s warm rebuild per restart. Any in-flight request /
module-level state is lost.

## Are there any Elysia bugs blocking us?

**No bugs, but two limitations.** Audited against `elysia@1.4.26`:

1. **No `removeRoute` / `unuse` / unmount API.** Routes go into
   `app.router.history` (an array), `app.router.http` (the
   trie), and `app.router.static` (the static map). All append-only.
   Once a plugin registers routes there's no clean way to take them
   back out from a running instance.

2. **`Bun.serve.reload({ fetch })` works perfectly.** Elysia stores
   the underlying Bun server on `app.server` (verified in
   `node_modules/elysia/dist/bun/index.js:407`: `app.server =
   Bun.serve(serve)`). Calling `app.server.reload({ fetch:
   newApp.fetch })` atomically swaps the handler on the existing
   socket — no port rebind, no in-flight request loss. This is the
   load-bearing API for the path-forward design below.

So Elysia itself isn't the obstacle. The obstacle is that our current
flow doesn't *use* `app.server.reload` — it relies on full child
restart for everything backend-side.

## What's already implemented but not triggered

`detectConfigChanges()` in `src/core/devBuild.ts:101` already handles
the *additive* half of in-place toggle:

- Compares old vs new framework dirs (`FRAMEWORK_DIR_KEYS`)
- Mutates `state.config` in place
- Sets vendor paths for newly-added frameworks (React/Angular/Svelte/
  Vue/Ember globals)
- Starts file watchers for new directories

But it's only called from `handleCachedReload`, which only fires on a
Bun `--hot` reload of `server.ts` — and Bun `--hot` is broken for our
setup (oven-sh/bun#30436, `BUN_HOT_WATCHER_BUG.md`). So this path
never executes.

`reloadConfig()` in the same file uses regex parsing of the source
file (`parseDirectoryConfig`) to bypass Bun's import cache, so it
*can* re-read the config without bun-internal cache invalidation.
That's good — no upstream blocker there.

## Two viable paths

### Path A — additive-only in-place

Cheap. Only handles "user added a framework directory in the config":

1. Wire a watcher on `absolute.config.ts` from inside `src/dev/fileWatcher.ts`.
2. On change, call (a newly-exported) `applyConfigHotUpdate()` that
   wraps `detectConfigChanges` + `rebuildManifest`.
3. If `detectConfigChanges` reports an addition only → log and return
   (no restart).
4. If anything is removed or non-framework keys changed → emit
   `[abs:restart]` marker (current restart behavior).

Caveats — this path is real but its value is limited:

- **Adding a framework dir without using it doesn't unblock anything.**
  The user's `server.ts` still has whatever routes it had. The new
  framework's pages don't exist until the user adds
  `handleReactPageRequest` (etc.) calls in `server.ts` — which
  triggers the CLI watcher's restart anyway.
- The realistic add flow is: user edits *both* config and server.ts in
  one work session → the server.ts edit forces a restart → in-place
  config handling becomes wasted machinery.

So Path A is straightforward to ship but solves a niche.

### Path B — framework-owned backend HMR (the real fix)

Build our own backend hot-module pipeline using `Bun.serve.reload`,
sidestepping Bun `--hot` entirely. This solves both `BUN_HOT_WATCHER_BUG.md`
*and* config toggle in one design:

1. **Capture the Bun.serve instance.** In `src/plugins/networking.ts`,
   after `app.listen(...)` returns, capture `app.server` to
   `globalThis.__bunServer`. (Reuse the existing
   `globalThis.__hmrDevResult` pattern — same lifetime semantics.)

2. **Make `networking` reload-aware.** On first call:
   `app.listen(...)` (current behavior). On subsequent calls (we
   detect via `globalThis.__bunServer` already being set): skip
   `listen()`, call `globalThis.__bunServer.reload({ fetch:
   app.fetch })` instead. The new Elysia instance replaces the old's
   handler atomically; the listening socket persists; in-flight
   requests handled by the new handler.

3. **Watcher trigger.** Add a watch on `server.ts` and
   `absolute.config.ts` from inside the bun child (in
   `fileWatcher.ts` or a sibling). On change, dynamic-import the
   entry with cache-bust query (`import(${pathToFileURL(entry)}?t=${
   Date.now()})`). Bun caches imports by URL, so the query param
   forces a fresh evaluation. The fresh module re-runs the entry's
   top-level code → calls `prepare()` → calls `networking` → which
   now triggers the reload path → new app's fetch is mounted on the
   live Bun.serve.

4. **`__hmrDevResult` cache invalidation on config change.**
   `prepare()` returns the cached `__hmrDevResult` to short-circuit
   re-evaluation. When the config changed, this cache is stale.
   Invalidate before triggering the dynamic re-import: clear
   `__hmrDevResult.manifest`, run `detectConfigChanges` to update
   `state.config`, and let the fresh `prepareDev` rebuild what it
   needs.

5. **Removal teardown** (still hard, but bounded). When a framework
   dir is removed:
   - Close watchers for that dir (track `state.watchers` per-framework
     instead of a flat array).
   - Unset vendor paths (`setXVendorPaths(null)`).
   - `rmSync(.absolutejs/generated/<framework>)`.
   - The user's `server.ts` may still reference
     `handleXPageRequest` for the removed framework — that's a
     user-side error, surfaced cleanly when the new module fails to
     re-evaluate. We catch the error and fall back to `[abs:restart]`
     (logs the error, child exits, parent's crash-loop limiter takes
     over after 5 attempts).

Estimated scope: 2–3 focused days. Touches `networking.ts`,
`devBuild.ts`, `fileWatcher.ts`, and a new `applyConfigHotUpdate`
entry point. Most risk is in (5) — Elysia's lack of route removal
means a stale `handleXPageRequest` reference would 500 on hit until
the user fixes their `server.ts`. Tractable and worth it because the
upside is large:

- Backend HMR works (no need to wait on bun-fix oven-sh/bun#30436).
- Config toggle works in-place for both add and (gracefully-degraded)
  remove.
- Process state preserved across edits — DB pools, sockets, in-flight
  requests, module-level globals, GC pressure — feels native instead
  of "compiled language reload" janky.

## Recommendation

Don't ship Path A alone — it's complexity for a niche. Ship Path B
when prioritized; until then, the CLI-restart pathway is the
supported answer. `BUN_HOT_WATCHER_BUG.md` and this doc both point at
the same underlying solution (Path B); shipping it would let us
delete chunks of both workarounds.

## Independent of the bun bug

Even if Bun fixes `--hot` (oven-sh/bun#30436), we'd *still* want Path
B for cleanly-handled removal teardown. `--hot` only helps with
re-evaluating modules; it doesn't solve "user removed a framework
directory and now the running Elysia instance has stale routes." So
this work doesn't get obsoleted by the upstream fix.

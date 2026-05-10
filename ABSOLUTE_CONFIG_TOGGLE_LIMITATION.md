# Backend HMR + framework-toggle: design notes & Bun caveats

**Status:**
- **Server entry edits**: in-place HMR via `Bun.serve.reload` shipped
  (Path B Step 2). PID stays constant, sockets persist, in-flight
  requests handled by the new app. See `src/plugins/networking.ts` +
  `src/dev/serverEntryWatcher.ts`.
- **`absolute.config.ts` edits**: still go via full child restart
  (CLI watcher → SIGTERM child → respawn). In-place handling for the
  additive case is implementable (Path A below) but solves a niche.
  Removal teardown remains restart-only because Elysia has no clean
  route-removal API.

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

### Path B — framework-owned backend HMR (SHIPPED)

**Status:** done as of `d97c14b`. Edit `server.ts`, the live
`Bun.serve` handler swaps in place via `app.server.reload({ fetch,
routes: {} })`. PID stable across edits.

#### Bun-specific behaviors discovered while building this

These are *not* clean Bun bugs (no minimal repro outside the
framework) but they're load-bearing constraints that shaped the
implementation. Documenting here so future-us doesn't re-discover
them on the next refactor.

1. **`import()` ignores `?query` cache-busting.** Node treats query
   strings as part of the URL key (different query → different
   module). Bun ignores the query and returns the cached module. Not
   a bug per Bun's design — but worth knowing.

2. **`Bun.serve.reload({ fetch })` doesn't clear the static `routes`
   map.** Elysia compiles routes into Bun.serve's `routes` option for
   perf at `.listen()` time. Reload's default behavior preserves that
   map. Pass `routes: {}` alongside `fetch` to fall through to the
   new handler. Documented behavior, sharp edge.

3. **`delete createRequire(...).cache[entry] + await import(entry)`
   under `bun --hot` re-runs the entry's top-level but the new
   evaluation reads stale source bytes — partially fixed in 1.3.14,
   not enough for our case.**

   Filed upstream in two pieces:

   - [oven-sh/bun#30447](https://github.com/oven-sh/bun/issues/30447)
     covered the original throw ("Requested module is not
     instantiated yet"). Fixed in 1.3.14-canary by the WebKit
     module-loader rewrite
     ([oven-sh/bun#29393](https://github.com/oven-sh/bun/pull/29393),
     "Upgrade WebKit to 87fd0daba19a", 2026-04-25) — but only for
     non-entry modules.
   - [oven-sh/bun#30449](https://github.com/oven-sh/bun/issues/30449)
     covers the residual: when the entry path itself is rewritten
     atomically (sed -i, vim default, prettier, VSCode, etc.),
     `--hot`'s pinned module record stays in place and userland
     cache invalidation re-runs the top-level *with stale source
     bytes*. Verified on `1.3.14-canary.1+fe735f8f0` — the new
     evaluation prints in-memory `VALUE=V1` while
     `readFileSync(entry)` from the same eval shows `V2`.

   Two minimal repros distinguish the cases:

   - changing `mod.ts` while entry is `main.ts`: V1 → V2 → V3 → V4
     correctly observed (post-#29393, the non-entry case works)
   - changing `server.ts` *as the entry* via `sed -i`: top-level
     re-runs but reads stale `V1` even after the file on disk
     has been rewritten to `V2` (#30449)

   So our framework hits the second case because `server.ts` is
   the entry and editors do atomic-rename writes. The workaround
   is to import from a *different path*: copy the entry to
   `.absolutejs-hmr-<n>.<ext>` next to the original (so relative
   imports resolve identically) and `await import()` that
   sibling. Bun parses+transpiles the sibling fresh because it's
   a new URL key; `--hot` doesn't own it; the new module's
   `networking` plugin call hits the reload-aware branch and
   swaps the live `Bun.serve` handler.

   Supporting code (already in tree, unchanged):
   - `fileWatcher.ts` and `dev.ts`'s `isAtomicWriteTemp` allowlist
     `.absolutejs-hmr-*` so the sibling copy doesn't trigger a
     spurious file-change pipeline
   - `serverEntryWatcher.ts`'s `triggerEntryReload` deletes the
     sibling in a `finally` block (best-effort; an orphan from a
     crashed process is harmless because the allowlist hides it
     from the watcher)

   `package.json` engines stays at `>=1.3.6`. The sibling-copy
   workaround makes the entry-stale-source bug irrelevant, so we
   don't need to gate users on the canary fix. Two paths to remove
   the sibling-copy:

   - **#30449 ships a fix** — drop the sibling copy and the two
     `.absolutejs-hmr-*` allowlist entries; userland delete-cache
     + await import on the entry now reads fresh.
   - **[#30436](https://github.com/oven-sh/bun/issues/30436) ships
     a fix** — `--hot`'s own watcher re-evaluates the entry on
     change, so we don't need userland cache invalidation at all.
     The entire entry-reload portion of `serverEntryWatcher.ts`
     plus the allowlist entries go away. #30449 becomes moot
     because we no longer trigger the buggy code path.
     `BUN_HOT_WATCHER_BUG.md` carries the detailed cleanup
     procedure for this case.

   #30436 is the structural blocker; #30449 is downstream of it.
   Either fix unblocks cleanup; #30436 is the bigger win.

#### Original Path B design (kept for context)

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

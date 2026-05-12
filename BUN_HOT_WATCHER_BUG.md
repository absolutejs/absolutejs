# Bun — `Bun.build()` inside a `--hot` entry permanently disables hot reload

**Tracking:** [oven-sh/bun#30436](https://github.com/oven-sh/bun/issues/30436)
**Status:** Reproduces deterministically on Bun 1.3.13 (Linux x86_64).
Workaround landed in this repo; see "Workaround." **Action when fixed:**
see "What to do when Bun fixes it."

## What's wrong upstream

Calling `Bun.build()` inside the top-level evaluation of a script
launched via `bun --hot` permanently disables `--hot`'s file-watcher
reload pipeline for that process. The watcher inotify FD is still
present in `/proc/<pid>/fd`, but the reload never triggers on entry
edits — the module never re-evaluates, and the live process keeps
serving the original module.

It doesn't matter if the build:

- writes to disk (`outdir`) or runs in-memory (no `outdir`)
- targets a real file or fails on a non-existent entrypoint
- finishes synchronously or asynchronously

Any `Bun.build()` call kills `--hot`. The only `Bun.build()` invocation
that *doesn't* kill `--hot` is the degenerate case where the build's
entrypoint is the running script itself — in that case the watcher
survives, presumably because the entry path is already registered
in the watch graph.

## Minimal repro (no AbsoluteJS needed)

```sh
mkdir /tmp/bun-bug && cd /tmp/bun-bug
```

```ts
// app.ts
declare global { var n: number | undefined; var done: boolean | undefined; }
globalThis.n = (globalThis.n ?? 0) + 1;
console.log(`n=${globalThis.n} v=A`);
if (!globalThis.done) {
  globalThis.done = true;
  try { await Bun.build({ entrypoints: ['nonexistent.ts'] }); } catch {}
}
```

```sh
bun --hot app.ts &
sleep 1
sed -i 's/v=A/v=B/' app.ts
sleep 1
sed -i 's/v=B/v=C/' app.ts
# Expected: log shows n=1 v=A, n=2 v=B, n=3 v=C
# Actual:   log shows n=1 v=A only — --hot is dead after the build call
```

Remove the `await Bun.build(...)` block and re-run: `n` increments
1 → 2 → 3 as expected. The build call is the only variable.

## How it bit AbsoluteJS

`prepare()` in dev mode calls `Bun.build()` several times to compile
the frontend bundle (per-framework: React vendor, Angular vendor,
Svelte vendor, etc.) before the user's `Elysia` app starts listening.
After those build calls, the running entry script (`server.ts`) is
no longer reloadable via `--hot`. Edits to route handlers don't
propagate; the live process keeps the original handler.

Frontend HMR keeps working because it goes through the framework's
own `fs.watch` + module server (not bun's `--hot`). Backend HMR is
the one that depends on `--hot` and breaks.

## Workaround (Path B, shipped)

We stopped relying on `--hot` for backend reload and own the pipeline
ourselves via `Bun.serve(...).reload({ fetch, routes: {} })`. See
`ABSOLUTE_CONFIG_TOGGLE_LIMITATION.md` for the full design rationale.
Concretely:

- `src/plugins/networking.ts` captures `app.server` to
  `globalThis.__absoluteBunServer` after the first `app.listen()`,
  and on subsequent `networking()` calls hits a reload-aware branch
  that calls `__absoluteBunServer.reload({ fetch, routes: {} })`
  instead of re-binding the port.
- `src/dev/serverEntryWatcher.ts` runs a `node:fs.watch` on
  `Bun.main` and `absolute.config.ts` from inside the bun child. On
  entry edits it does the natural `delete require_.cache[entryPath];
  await import(entryPath)` — the fresh module's top-level calls
  `networking()`, which hits the reload-aware branch and atomically
  swaps the `Bun.serve` handler. The sibling-copy workaround for
  [oven-sh/bun#30447/#30449](https://github.com/oven-sh/bun/issues/30449)
  (entry-path cache invalidation reads stale source under `--hot`)
  was retired 2026-05-12 after verifying on Bun 1.3.14-canary.1
  that the natural pattern returns fresh bytes — see
  `tests/integration/hmr/lifecycle/bun-entry-natural-pattern-sentinel.test.ts`
  for the snapshot tripwire that catches a regression.
- The `[abs:restart]` stdout-marker pattern in `rebuildTrigger.ts`
  is **separate** and stays: it covers files *inside* framework
  directories that the dev server's classifier can't match.
- The CLI-level root watcher in `dev.ts` is also still around, but
  for `absolute.config.ts` framework-removal and non-framework-key
  changes only — the entry-edit path is now in-place.

PID stays constant across edits; new app's routes serve immediately;
in-flight requests, sockets, DB pools, module-level globals carry
across.

## What to do when Bun fixes it

If `Bun.build()` no longer kills `--hot`'s reload pipeline (this
issue), `--hot` itself re-evaluates the entry on file change — and
**all of `serverEntryWatcher.ts`'s entry-reload machinery becomes
unnecessary**.

Cleanup steps (when fix lands):

1. Delete the entry-reload portion of
   `src/dev/serverEntryWatcher.ts` — `triggerEntryReload`, the
   `entryWatcher` setup. Keep the config watcher and
   `triggerConfigChange` (in-place framework-add still useful).
2. The networking plugin's reload-aware branch can stay (still
   triggered by `--hot`'s own re-evaluation when it re-runs the
   entry's top-level — `globalThis.__absoluteBunServer` is set on
   first listen, present on re-eval, branch fires correctly). It's
   the same code path either way; just the trigger source changes.
3. Verify in an example project: `bun run dev`, edit `server.ts`
   from a real editor (sed/vim/VSCode), curl the route. PID stable,
   new value served.
4. Bump `package.json` `engines.bun` to whatever release contains
   the fix.

After this we can also close [#30449](https://github.com/oven-sh/bun/issues/30449)
on our side if upstream hasn't already — the bug remains real but
it stops affecting us.

## Filed issue body (cached)

Cached copy of the body filed to [oven-sh/bun#30436](https://github.com/oven-sh/bun/issues/30436)
in case the upstream gets edited.

> ### Title
>
> `Bun.build()` inside a `bun --hot` entry permanently disables hot
> reload
>
> ### Bun version
>
> `1.3.13+bf2e2cecf`
>
> ### Platform
>
> Linux 6.6.114.1-microsoft-standard-WSL2 x86_64. Filesystem: ext4.
>
> ### Reproduction
>
> ```sh
> mkdir /tmp/bun-bug && cd /tmp/bun-bug
> cat > app.ts <<'EOF'
> declare global { var n: number | undefined; var done: boolean | undefined; }
> globalThis.n = (globalThis.n ?? 0) + 1;
> console.log(`n=${globalThis.n} v=A`);
> if (!globalThis.done) {
>   globalThis.done = true;
>   try { await Bun.build({ entrypoints: ['nonexistent.ts'] }); } catch {}
> }
> EOF
> bun --hot app.ts &
> sleep 1; sed -i 's/v=A/v=B/' app.ts; sleep 1
> sed -i 's/v=B/v=C/' app.ts; sleep 1
> ```
>
> ### Expected
>
> Log prints:
>
> ```
> n=1 v=A
> n=2 v=B
> n=3 v=C
> ```
>
> ### Actual
>
> Log prints `n=1 v=A` only. The `Bun.build()` call (which itself
> rejects, since the entrypoint doesn't exist) silently disables
> `--hot`'s reload pipeline for the rest of the process's life.
>
> Removing the `await Bun.build(...)` block and re-running prints all
> three values as expected — `--hot` works correctly when no
> `Bun.build()` is called from the entry.
>
> ### Notes
>
> - It doesn't matter whether `Bun.build`'s entrypoint exists, whether
>   the build succeeds or rejects, or whether an `outdir` is set. Any
>   `Bun.build()` call from the entry kills `--hot`.
> - The one exception: if `Bun.build`'s `entrypoints` is the running
>   script itself, `--hot` continues to fire. Targeting a *different*
>   file (or a non-existent file) breaks it.
> - The `inotify` FD is still present in `/proc/<pid>/fd` after the
>   build call, so the watcher isn't being torn down — it's the
>   reload-on-event pipeline that's silently disabled.
> - This breaks any framework that runs a build pipeline inside the
>   user's entry script (e.g. SSR / SSG frameworks that pre-bundle
>   client code on dev-server startup). In our case it disables
>   backend HMR on every save in AbsoluteJS dev.

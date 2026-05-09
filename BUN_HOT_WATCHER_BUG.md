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

## Workaround

`src/cli/scripts/dev.ts` registers a `node:fs.watch` on the project
root (non-recursive) and calls `scheduleServerRestart` on any change
that isn't an output dir / log / temp file. The bun child (`bun --hot
--no-clear-screen server.ts`) is killed and respawned. Heavyweight
(full process restart + warm rebuild instead of in-place re-eval)
but reliable across every editor.

The `[abs:restart]` stdout-marker pattern in `rebuildTrigger.ts` is
**separate** from this workaround and stays in place: it covers files
*inside* framework directories that the dev server's classifier can't
match. Don't conflate the two.

## What to do when Bun fixes it

When `Bun.build()` no longer disables `--hot`'s reload pipeline (or
when AbsoluteJS moves the frontend build off the entry's evaluation
path — see below), three steps:

1. **Delete the root watcher in `src/cli/scripts/dev.ts`** — the
   `const watcher = watch(serverEntryDir, { recursive: false }, ...)`
   block, the `ROOT_RESTART_DENY` Set, and the `closeWatcher`
   `process.once` registrations. Keep the `[abs:restart]` marker and
   `scheduleServerRestart` (still needed for the marker pathway).
2. **Verify backend HMR works without restart.** In an example
   project: `bun run dev`, edit `server.ts` from a real editor, hit
   the route. The bun child PID should stay constant across edits;
   the route should serve the new value. Re-eval should be ≪100 ms vs
   the current ~1–4 s child respawn.
3. **Bump the minimum Bun version** in `package.json`'s `engines`
   field to whatever release contains the fix, so the workaround
   removal isn't reachable on older Bun.

## Alternative: own the backend reload pipeline

If we don't want to wait for the upstream fix, the right framework
fix is to stop relying on `--hot` for backend reload and instead use
Bun's `Bun.serve(...).reload({ fetch })` API directly — which works
regardless of `--hot` state. Concretely:

- The `networking` plugin holds a reference to the underlying
  `Bun.serve` instance (Elysia exposes it as `app.server` post-1.x).
- The framework's existing `fileWatcher` is extended to watch the
  server entry file (and its non-frontend imports).
- On change, dynamically re-import the entry with cache-busted query
  (`import('./server.ts?t=' + Date.now())`), grab the new app's
  `.fetch`, and call `serveInstance.reload({ fetch: newFetch })`.

This mirrors how frontend HMR works: framework-owned, in-place,
process-preserving. If we ever ship this, the upstream `--hot` bug
becomes irrelevant for our use case.

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

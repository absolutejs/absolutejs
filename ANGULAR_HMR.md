# Angular HMR in AbsoluteJS — what to fix

> Working document for making Angular hot module reload (HMR) a staple
> feature of AbsoluteJS where component, service, and route state is
> preserved across edits without a full page reload.
>
> The bug list and root-cause analysis here came out of a long porting
> session in `~/onspark/absolutejs/dealroom` (sixth-summit → absolutejs
> port, ~May 2026). Every numbered item below was either reproduced
> repeatedly during that session or surfaced from grepping the
> AbsoluteJS source while planning the fix.

---

## 0. The current state (so we agree on the baseline)

`src/dev/client/handlers/angularRuntime.ts` already implements the right
primitives — prototype swapping on `ɵcmp` metadata, registry keyed by
source path, manual `ApplicationRef.tick()` for zoneless. Component
instances aren't destroyed, so their fields and injected services
survive an edit. The pieces are there.

What broke during the dealroom session was **not** the runtime failing
to swap a class — it was the *build pipeline around it* getting into
wedged states that the runtime never saw because the server crashed
first or returned stale artifacts. So Phase 1 is making the build
pipeline survive an editing session, then Phase 2 is hardening the
actual hot-swap.

---

## Phase 1 — Make HMR survivable across edits (correctness fixes)

These are the "kill the dev server, clear the build dir, restart"
workflow that broke at least 8 times in this session. Each one needs
to stop being a thing.

### 1.1 SSR Angular module identity drift after HMR cycles

**STATUS: DONE** — dev mode skips `buildAngularServerVendor` entirely; bare `@angular/*` specifiers in `loadAngularDeps()` and bundled SSR pages let Bun's node_modules resolution dedupe to one canonical instance. Production unchanged. Verified end-to-end: example/server.ts dev → /angular returns 200, no NG0203.


**Symptom seen repeatedly:**

```
NG0203: The `AccountService` token injection failed.
  at injectInjectorOnly (.../node_modules/@angular/core/fesm2022/_effect-chunk2.mjs:667)
  at new LayoutComponent (1:17)
```

Stack pointed at the *real* `node_modules/@angular/core`, but
`LayoutComponent` was instantiated from a bundle whose `@angular/core`
reference resolves through `build/angular/vendor/server/angular_core.js`
(which itself wraps the bundled chunk). After an HMR cycle the SSR
runtime had two `@angular/core` instances live, with separate
`currentInjector` globals — the bundled chunk set the injector, but
`inject()` was reading it from the real one.

**Files involved:**

- `src/build/buildAngularVendor.ts` — generates the SSR vendor entry
- `src/build/vendorEntrySource.ts` — the entry-source generator
- `src/core/devBuild.ts` / `src/core/build.ts` — orchestrate the SSR +
  vendor builds

**Root cause:** Bun's `--hot` invalidates and re-evaluates modules, but
`@angular/core` ends up resolved through *two* paths in the SSR
runtime: (a) the bundled vendor for user pages, (b) the real package
for any code that imports it directly (Angular CLI tooling,
`@angular/platform-server`, `@angular/ssr`). After the first build,
both paths are loaded; after HMR, the user-page path may pick up the
new bundled vendor while the platform path still holds the old one.
Same `currentInjector` problem we fixed at *bundle* time in beta.842 /
beta.844, just re-introduced by HMR.

**Change needed:** Pin a single `@angular/core` instance for the SSR
process and fail loudly if a second copy is requested.

Concrete: add a `Bun.plugin({ name: 'absolutejs-angular-core-pin' })`
that registers in `prepare.ts`, intercepts every `@angular/core`
resolve on the server side, and forces it to one canonical path.
Either:

- (a) The bundled vendor `build/angular/vendor/server/angular_core.js`
  (stop importing real `@angular/core` for SSR — current direction).
- (b) The real `node_modules/@angular/core` (skip the SSR Angular
  vendor build entirely; let Bun de-dupe).

(a) keeps the existing pipeline; (b) is simpler if it works. Worth
probing both to see which one Bun's HMR can actually keep stable.

Also: instrument the SSR rendering entry to count Angular core
instances and `console.warn` if it sees more than one. That alone would
have saved hours of "is this beta.X regression or HMR".

---

### 1.2 `build/.build.lock` wedges after HMR death-loops

**STATUS: DONE** — single-file `<projectRoot>/.absolutejs/build.lock` with JSON `{pid, port, startedAt}`, atomic `wx` create, PID-liveness check on EEXIST (orphan removed with one warning line), 10-minute mtime check dropped, exit/SIGINT/SIGTERM/uncaughtException handlers register on first acquire.


**Symptom:** `Timed out waiting for AbsoluteJS build directory lock:
/home/alexkahn/onspark/absolutejs/dealroom/build`. Required `rm -rf
.build.lock` to recover. Hit this maybe 3 times.

**File:** `src/utils/buildDirectoryLock.ts` (line 130 in the trace)

**Root cause:** Lock has no orphan detection. When the `bun --hot`
child exits abnormally (segfault, OOM, `kill -9`), the lock dir's
`owner` file stays on disk. The next `bun dev` reads `owner`, doesn't
recognize it, waits, eventually times out.

**Change needed:**

1. Write the holder PID to `<lock>/owner` along with start time.
2. On acquire, if `owner` exists, `process.kill(pid, 0)` to test
   liveness. If `ESRCH`, force-release and acquire.
3. Register `process.on('exit')` + `SIGINT` + `SIGTERM` handler to
   release the lock on graceful shutdown (currently relies on the FS
   lock outliving the process).

---

### 1.3 Stacked dev servers — `pkill bun dev` leaves orphans

**STATUS: DONE** — Vite-style port resolution (probe configured port, fall through `portRange-1` neighbors), `dev.{port,portRange,strictPort,host,https,watchDirs}` config schema with env precedence (`ABSOLUTE_PORT`/`_RANGE`/`_STRICT_PORT`/`_HOST`/`_HTTPS`), child spawned via `node:child_process.spawn` with `detached:true` so cleanup can `kill(-childPgid, ...)` on parent exit/SIGINT/SIGTERM and cascade to the whole subtree.


**Symptom:** `pkill -9 -f "bun dev"` and a follow-up `ps -ef | grep bun
--hot` would show two PIDs both bound (or trying to bind) to `:3000`.
The orphan was an old `bun --hot --no-clear-screen src/backend/server.ts`
whose parent wrapper was already dead.

**Files:**

- `src/cli/scripts/dev.ts` (line 158-202 — the `Bun.spawn` block)
- `src/cli/scripts/dev.ts` cleanup handler (~line 227)

**Root cause:** `Bun.spawn(['bun', '--hot', ...], { ... })` doesn't put
the child in a new process group. When the parent dies un-cleanly, the
child doesn't get cascaded SIGTERM. SIGKILL on the parent doesn't
propagate at all.

**Change needed:**

1. Spawn with a new process group (Bun doesn't expose `detached: true`
   directly — work around with `bash -c` setpgid wrapper or move to
   `child_process.spawn` for this one call).
2. On parent's `exit` / `SIGINT` / `SIGTERM`, send `process.kill(-childPgid,
   'SIGTERM')` to kill the whole tree.
3. On startup, detect if `:3000` is already bound; refuse to start
   with a clear message ("port held by PID X — kill it first") instead
   of racing.

---

### 1.4 `rewriteImports` ENOENT during mid-build edits

**STATUS: DONE** — new `src/build/rewriteImportsPlugin.ts` exposes `rewriteBuildOutputs(BuildArtifact[], vendorPaths)` and `rewriteBuildOutputsWith(...)` that operate on the just-emitted `BuildArtifact[]` straight off `Bun.build()`'s result. Standalone iteration over a captured path list is gone. ENOENT on read or write is swallowed (next rebuild already in progress will re-rewrite). `fixMissingReExportNamespaces` and `nativeRewriteImports` (Zig-accelerated) live inside the new module. `rewriteImports.ts` becomes a compat shim forwarding to the plugin.


**Symptom:**

```
ENOENT: no such file or directory, open '/.../build/frontend/pages/checkout.qzmvzpmd.js'
  at .../absolute/src/build/rewriteImports.ts:56
```

When saving during a rebuild, the previous build's `<page>.<hash>.js`
had already been swept and the new one wasn't written yet.
`rewriteImports` saw the path from the old manifest.

**File:** `src/build/rewriteImports.ts:56`

**Root cause:** The post-build rewrite step reads file paths from a
list captured at scheduling time, not at execution time. Race window
between file deletion and rewrite.

**Change needed:**

1. Wrap the `Bun.file(filePath).text()` in `try/catch`; treat `ENOENT`
   as "file already swept by next cycle, skip". This is the right
   behavior — the rewrite is for the build that just completed, but
   the next build is already in progress and will re-rewrite.
2. Even better: make the rewrite a build-output transform plugin so
   it runs in-pipeline and never sees stale paths.

---

### 1.5 Multi-cycle "ready in" thrash from build-output watching

**STATUS: DONE** — `getWatchPaths` now collects a positive include-list (configured framework dirs + conventional source dirs `src/`, `db/`, `assets/`, `styles/` when present + user `dev.watchDirs`), removed `getSiblingDirs`'s scan of the common-ancestor parent. `shouldIgnorePath` keeps a hard-deny list of build/output segments (`build|generated|compiled|indexes|.absolutejs|node_modules|.git|.test-builds|dist`) so even if a positive root accidentally encloses one, watcher events from inside it are dropped.


**Symptom:** Single `bun dev` log:

```
ABSOLUTEJS v0.19.0-beta.845 ready in 17.37s
ABSOLUTEJS v0.19.0-beta.845 ready in 21.74s
ABSOLUTEJS v0.19.0-beta.845 ready in 22.21s
ABSOLUTEJS v0.19.0-beta.845 ready in 22.43s
ABSOLUTEJS v0.19.0-beta.845 ready in 21.50s
```

Five rebuilds with no source change. Each was a real ~20s build.

**File:** `src/dev/fileWatcher.ts`

**Root cause:** The watcher's globs aren't excluding `build/`. The
build emits files into `build/`, the watcher sees them, schedules
another build, which emits more files, etc. Damps out eventually
because hashes converge, but it burns minutes of CPU and produces
transient broken states.

**Change needed:** Hard exclude `build/`, `.absolutejs/`,
`node_modules/`, `dist/`, `.absolute-build.lock` from the watcher's
glob. Audit `src/dev/configResolver.ts` for the actual glob — should
be a positive include list (`src/**`, `db/**`, etc.) rather than a
negative exclude list, easier to reason about.

---

### 1.6 Stale build artifacts — source edited, build dir didn't update

**STATUS: DROPPED** — confirmed `src/dev/dependencyGraph.ts` lines 207-218 (`extractAngularDependencies` + `extractStyleUrlsDependencies`) already wires `templateUrl` / `styleUrl` / `styleUrls` on `@Component`-bearing `.ts` files into the graph. The §1.6 symptom was caused by §1.5's rebuild thrash leaving stale outputs from earlier cycles in place; now resolved by the positive watch list.


**Symptom:** Edited `portal.ts` at 14:35; `build/frontend/pages/portal.X.js`
mtime stayed 14:23 for a long time. HMR-served bundle was stale code.

**Root cause hypothesis:** Combination of 1.5 (the watcher cascading
rebuilds wedges the queue) and the `dependencyGraph`
(`src/dev/dependencyGraph.ts`) not invalidating downstream paths when
an Angular template/CSS file changes — Angular's
component-html-css triplet doesn't always have its `.ts` parent in the
graph.

**Change needed:** Audit `src/dev/dependencyGraph.ts` to make sure that
when `<name>.html` or `<name>.css` changes, the `<name>.ts` component
file is invalidated alongside (since the compiled .js inlines the
template/styles). Probably already handled for React / Svelte but
Angular's templateUrl/styleUrl-via-disk pattern is unique.

---

## Phase 2 — State preservation done right (the actual headline feature)

With Phase 1 done, the dev server stays alive across edits. Now make
`angularRuntime.ts` correct for every edit type.

### 2.1 Per-edit-type HMR routing

The current `angularRuntime.ts` does prototype swapping on the
component class. That covers a class-body edit. It does *not*
differentiate the edit type, so:

- **Edit `.html` template** — should `ɵcmp.template` swap only,
  instance and state preserved.
- **Edit `.css` styles** — should hot-inject styles, no Angular CD
  cycle needed at all.
- **Edit `.ts` class body** — current prototype swap path, preserves
  fields + subscriptions.
- **Edit a service** (`@Injectable`) — the existing singleton's
  prototype gets `Object.assign`-merged with the new class's
  prototype, preserving any `BehaviorSubject` / cache fields. This is
  a separate code path and probably doesn't exist yet.
- **Edit `provideRouter([...])` / route definitions** — call
  `Router.resetConfig(newRoutes)` instead of full re-bootstrap.

**File to extend:** `src/dev/client/handlers/angularRuntime.ts`
(currently component-class focused).

**File to extend:** `src/build/compileAngular.ts` — needs to emit
metadata about *which file kind* changed (template / style / class /
service / route) so the client knows which strategy to apply. Could be
a `__ABS_HMR_KIND__` export per chunk.

---

### 2.2 Service HMR

Services are tricky because they're singletons. The existing instance
is referenced from every consumer — replacing it would require walking
the injector tree.

The practical strategy:

1. Detect the file is `@Injectable({ providedIn: 'root' | 'platform' })`.
2. Find the existing singleton instance in the root injector.
3. `Object.setPrototypeOf(instance, NewClass.prototype)` — method
   bodies updated.
4. For new fields added in the edit: copy them from a fresh `new
   NewClass(...)` (without invoking constructor side effects? — needs
   care).
5. For removed fields: leave them, GC will pick up when nothing else
   references them.
6. Re-run any `effect()` / `afterNextRender()` registrations the
   constructor would have made. This is the hard part — needs a
   `[[constructorSideEffects]]` registry.

Probably ship as "best-effort, force-reload on detected complex
change" first — the 80% case (editing a method body of a service) is
straightforward.

---

### 2.3 Template-only HMR (the win the user actually feels)

Edit a `.html`, save, see the change in <100ms with no state loss.
This is the experience users associate with "Vite-tier HMR."

Angular has `ɵreplaceMetadata` since v17 (or `ɵɵcomponent.template =
newTemplate; ApplicationRef.tick()`). The Angular CLI's HMR uses this.
We need to:

1. **At build time:** when only an `.html` changes, emit a "template
   patch" — just the new compiled template function — instead of
   rebuilding the entire page bundle.
2. **At runtime:** the HMR client receives the patch, looks up the
   component by source-file path in the registry, swaps `ɵcmp.template`,
   calls `ApplicationRef.tick()`.

**File:** `src/build/compileAngular.ts` would need a "fast path" that
detects template-only changes and emits a smaller artifact.

**File:** `src/dev/client/handlers/angularRuntime.ts` already has the
registry — extend with a `applyTemplatePatch` method.

Without this, every template edit triggers a full bundle rebuild
(~15-20s in dealroom). **This is probably the single biggest UX
improvement** the user would feel.

---

### 2.4 Style-only HMR

Even simpler — when only a `.css` (or `.scss`) changes, inject a new
`<style>` tag and remove the old. No Angular involvement needed.
Should work for `:host` and ViewEncapsulation.None alike.

**File:** `src/dev/client/handlers/angularRuntime.ts` — add
`applyStylePatch` keyed by source path → DOM `<style>` element.

---

### 2.5 Module-evaluation pinning for the bundled `@angular/core`

The dual-instance hazard from §1.1 is what makes service HMR risky
too. After a service edit, if the user code's `inject(SomeService)`
resolves through one Angular core but the existing singleton was
registered via another, we get a "no provider found" error or worse,
a phantom second singleton.

The fix is upstream of HMR: make the bundled `@angular/core` the
*only* Angular core in the SSR + dev process. Once that's done, HMR
can safely swap module bodies without breaking DI identity.

This is the same root issue as 1.1 — listing it again here because it
directly enables service HMR to be reliable.

---

## Phase 3 — Polish

These are the small things that make it feel like a finished feature
instead of "we have HMR I guess."

### 3.1 Edit-type indicator in the dev overlay

Tiny corner toast: "🔁 template patched · 23ms" / "⚙️ service prototype
swapped · 47ms" / "💅 styles · 8ms" / "🔄 full reload (route config
changed) · 1.2s". Tells the user what just happened. Files:
`src/dev/client/errorOverlay.ts` already exists; extend with success
indicator.

### 3.2 "Full reload" escape hatch

Keyboard shortcut (e.g. `Ctrl+Shift+R` in the dev overlay) that forces
a full reload. For when state preservation accidentally hides a real
bug.

### 3.3 Per-component HMR opt-out

A `// @hmr-disable` magic comment at the top of a `.ts` file forces a
full reload for any edit to that file. Useful for components with
side-effecting constructors that don't survive prototype swap.

### 3.4 SSR warning when a bundle has cross-module Angular core

Build-time check in `verifyExports.ts` (or wherever `Verifying
exports...` runs): walk the SSR bundle's resolved module graph and
warn if `@angular/core` resolves to more than one path. Catches §1.1 /
§2.5 regressions at build time instead of at runtime.

---

## Suggested order of operations

If landing this incrementally, each phase makes the next one viable:

1. **§1.5** (watcher excludes) — instant win, kills the rebuild thrash
   that's poisoning everything else.
2. **§1.2** (lock orphan detection) + **§1.3** (process group cleanup)
   — together fix "I have to manually clean state to recover."
3. **§1.4** (rewriteImports ENOENT tolerance) — tiny patch.
4. **§1.1 / §2.5** (single Angular core) — biggest correctness win,
   unblocks Phase 2.
5. **§3.4** (build-time core-instance check) — guardrail for the above.
6. **§2.3** (template-only HMR) — biggest user-felt win.
7. **§2.4** (style-only HMR) — easy.
8. **§2.1** (per-edit-type routing) — wires the above two into the
   existing runtime.
9. **§2.2** (service HMR) — last because it depends on §2.5 being
   rock-solid.
10. **§3.1, §3.2, §3.3** — polish.

§1.1 is the load-bearing one. Most of the headaches in this session —
the SSR errors, the half-states, the "is this real or am I just in a
bad HMR cycle" — all trace back to two `@angular/core` instances
co-existing in the SSR runtime. Fix that and Phase 2 becomes a regular
implementation effort instead of fighting the runtime.


---

## Phase 1 verification

End-to-end checks the implementer is expected to walk through manually before declaring Phase 1 done. Run them in `~/onspark/absolutejs/dealroom` after rsyncing the local `dist/` over (or `bun link`).

1. **Cold dev start clean** — `cd ~/onspark/absolutejs/dealroom && rm -rf build .absolutejs && bun dev`. Server must come up without "Dependency vendor build had errors" and without NG0203 in `/tmp/dealroom-dev.log`. **PASS / FAIL: <to be filled>**
2. **Edit storm survives** — edit `src/frontend/components/layout/layout.component.ts` (add a comment), save 5 times in a row at ~1s intervals. No NG0203 SSR errors should appear; the dashboard remains reachable on every save. **PASS / FAIL: <to be filled>**
3. **No orphan after SIGKILL** — kill the parent `bun dev` with SIGKILL. After a 2s grace period, `ps -ef | grep "bun --hot"` returns zero rows. **PASS / FAIL: <to be filled>**
4. **Vite-style port fallback** — start dev. In another shell, start dev again — the second one picks `:3001` (or the next free port) and logs the Vite-style "Port 3000 is in use, trying another one... → http://localhost:3001/" line. **PASS / FAIL: <to be filled>**
5. **Lock cleanup on Ctrl-C during boot** — `rm -rf .absolutejs/build.lock` if it exists, start dev, IMMEDIATELY hit Ctrl-C during boot. After the kill, `.absolutejs/build.lock` does NOT exist. **PASS / FAIL: <to be filled>**

Steps 1, 4, and 5 were exercised against the local example (`example/server.ts`) during implementation as a smoke test; full dealroom coverage is the implementer responsibility before merging.

# Angular with zone.js (opt-in) — plan

Status: Phase 1 implemented (uncommitted), verified in dev and production with a
packed tarball. Phases 2–4 are open.

## Goal

AbsoluteJS Angular support is zoneless. Many existing Angular apps and
libraries still depend on zone.js: plain fields updated from timers, manually
added event listeners, `NgZone.run`/`onStable`, and libraries that call
`zone.runOutsideAngular()` then `zone.run(() => output.emit())`.

The opt-in is this config:

```ts
export default defineConfig({
	angularDirectory: './src/angular',
	angular: { changeDetection: 'zone' } // 'zone' | 'zoneless', default 'zoneless'
});
```

The app installs zone.js itself (`bun add zone.js`; 0.16.x for Angular 21).

## Step 1: probe results (zone.js 0.16.2, Angular 21.2.6, Bun 1.4.4)

Probe scripts are in the session scratchpad (`probe/*.mjs`). Every render uses
`renderApplication` + `bootstrapApplication` + `provideServerRendering`, with a
component that sets a plain field (no signals) and renders `<p>{{ v }}</p>`.

### 1a. zone.js on the Bun server: SSR waits for stability

| case | zone (Bun) | zone (Node 23.9) | zoneless (Bun) |
| --- | --- | --- | --- |
| A `setTimeout` in `ngOnInit` | `A-done` (81ms) | `A-done` | `init` |
| B `async ngOnInit` + `await Promise.resolve()` | `init` | `init` | `init` |
| C `await new Promise(r => setTimeout(r, 60))` | `init` (waited 65ms) | `init` | `init` |
| D timer scheduled after an `await` | `init` (4ms) | `init` | `init` |
| E `HttpClient.get` (fetch backend) in `ngOnInit` | `HTTP-OK` (91ms) | `HTTP-OK` | `init` |
| F `HttpClient.get` after an `await` | `init` | `init` | `init` |
| G `NgZone` class / `Zone.current` | `NgZone/angular` | same | `NoopNgZone` |
| H raw global `fetch()` in `ngOnInit` | `init` | `init` | `init` |
| I `setInterval` x3 then clear | `3` | `3` | `0` |

Conclusions:

- zone.js patches Bun's timers and Angular's zone-based stability works on the
  Bun server exactly like on Node. Bun and Node give the same results in every
  row.
- Native `async`/`await` loses the zone after the first `await` on both
  runtimes (B, C, D, F). This is the known zone.js limitation; the Angular CLI
  downlevels async functions for zone apps for this reason. Bun's transpiler
  cannot downlevel, and this repo's Angular pipeline emits ES2022 (AOT:
  `ts.ScriptTarget.ES2022`; dev JIT: `Bun.Transpiler`, which keeps `async`).
- Raw `fetch` is not tracked by zone on either runtime (H). Use `HttpClient`.

### 1b. Downleveling restores zone tracking

Same component sources passed through `ts.transpileModule` at ES2022 vs ES2016
(ES2016 turns `async`/`await` into `__awaiter` + generators driven by the
global, zone-patched `Promise`):

| case | ES2022 | ES2016 |
| --- | --- | --- |
| B microtask after await | `init` | `B-done` |
| C await timer | `init` | `C-done` (64ms) |
| D timer after await | `init` | `D-done` (67ms) |
| F HttpClient after await | `init` | `F-HTTP-OK` (98ms) |

### 1c. The real Bun incompatibility: Bun.serve rejects ZoneAwarePromise

zone.js replaces the global `Promise` with `ZoneAwarePromise`. `Bun.serve`
only accepts a native Promise (or a Response) from a handler. With zone.js
loaded:

| route | result |
| --- | --- |
| `Bun.serve` `fetch` returns a Response | 200 OK |
| `Bun.serve` `fetch` is an `async` function | 200 OK (async functions return native promises) |
| `Bun.serve` `fetch` returns `Promise.resolve(res)` | **200 "Welcome to Bun! To get started, return a Response object."** plus `error: Expected a Response object, but received 'ZoneAwarePromise {…}'` |
| Elysia 2.0.0-rc.1 sync route / `new Response` route | 200 OK |
| Elysia async route, async JSON route, async `beforeHandle` | **200 "Welcome to Bun!"** |

This is silent: the client gets a 200 with Bun's placeholder text. Node's
`http` server has no equivalent check. This is a hard blocker for loading
zone.js into an AbsoluteJS server as-is.

Fix (probed, then implemented): wrap `Bun.serve` and each server's `reload` so
`fetch`, `error` and every `routes` handler adopt a thenable into the native
Promise. With the wrapper every Elysia route above returns the right body, a
streaming `ReadableStream` response works, and 2000 sequential requests to an
async route took 72–142ms with zone vs 104–105ms without (noise; no measurable
overhead).

### 1d. Mixed and late loading

- Angular evaluated and rendered zoneless first, then `zone.js/node` loaded,
  then a zone render: works (`timer-done`). Zoneless renders still work after
  zone.js is loaded, but Angular logs NG0914 ("using zoneless change detection
  but still loading Zone.js") in dev mode for each one.
- Zone must still be installed before the server listens: once zone.js has
  patched `Promise`, any already-bound Bun.serve handler starts returning
  ZoneAwarePromise.

## Zoneless assumptions found (and what Phase 1 does)

| place | assumption | Phase 1 |
| --- | --- | --- |
| `src/angular/ssrRender.ts` `buildProviders` | `provideZonelessChangeDetection()` | picks `provideZoneChangeDetection({ eventCoalescing: true })` when `isAngularZoneMode()` |
| `src/angular/angularDeps.ts`, `types/angular.ts` | no zone provider in deps | adds `provideZoneChangeDetection` |
| `src/angular/pageHandler.ts` | none beyond `buildProviders` | unchanged |
| `src/build/compileAngular.ts` generated client indexes (dev and prod) | `provideZonelessChangeDetection()` | zone mode: `import 'zone.js'` first, `provideZoneChangeDetection({ eventCoalescing: true })` |
| `src/build/compileAngular.ts` AOT emit and dev JIT emit | native `async` | zone mode: `downlevelAsyncForZone` (TS ES2016, only files containing `async`) |
| `src/core/prepare.ts` | — | zone mode: `installAngularZoneRuntime()` right after config load, before the app listens |
| `src/core/productionRuntime.ts` | `angular` not carried to `absolute start` | carries `angular.changeDetection` only (providers are not serializable; they are baked into page bundles) |
| `src/angular/islands.ts` (server island render + client island app) | zoneless | unchanged: islands stay zoneless (NoopNgZone) in zone mode |
| `src/angular/lowerServerIslands.ts`, `lowerDeferSyntax.ts`, streaming slots | resolve through promises / `PendingTasks`, not zone | unchanged; not exercised in zone mode yet |
| `src/dev/angular/fastHmrCompiler.ts` (tier 0 / 1a update modules) | emits ES2022, keeps `async` | unchanged (see risks) |
| `src/dev/client/handlers/angularRemount.ts` (tier 1a) | calls `createComponent` + `tick()` from the HMR socket callback | unchanged; worked in the e2e run (below) |
| `ɵɵreplaceMetadata` (tier 0) | — | Angular already re-creates views inside `zone.run` |
| `src/cli/add/dependencies.ts` | "Angular runs zoneless, so no zone.js" | unchanged |
| `src/utils/loadConfig.ts` reserved keys | — | not changed: `angular` without `entry`/`command` already can't be a workspace service, and reserving it would break a workspace service named `angular` |

## Phase 1 (done): opt-in zone mode for Angular pages

API: `angular.changeDetection: 'zone' | 'zoneless'` (type
`AngularChangeDetection` in `types/build.ts`).

Pieces:

- `src/angular/zoneRuntime.ts`: process-wide mode on `globalThis` (the build,
  dev runtime and production server load it from different bundles),
  `installAngularZoneRuntime()` (imports `zone.js/node` from the app at runtime
  with a clear error if missing, wraps `Bun.serve` + `reload`).
- `src/build/downlevelAsyncForZone.ts`.
- Wiring in `build.ts`, `prepare.ts`, `productionRuntime.ts`, `ssrRender.ts`,
  `angularDeps.ts`, `compileAngular.ts`.
- Tests: `tests/integration/angular/zoneRuntime.test.ts` (subprocess probe:
  Elysia async routes under zone, native async vs downleveled SSR) and a
  `productionRuntime` unit case.

Exit criteria and results (scaffolded app, packed tarball, Angular 21.2.26,
zone.js 0.16.2, `ngx-infinite-scroll@21.0.0` as the zone-dependent library):

- [x] Production SSR waits for an `async ngOnInit` that awaits a timer:
  `resolved after await (in zone: true)`; `NgZone.isInAngularZone()` true.
- [x] Production hydration reuses the SSR nodes (the SSR `<p>` node is the
  live node after bootstrap).
- [x] Browser change detection without signals: a timer-set field, a manual
  `addEventListener` counter, a `(click)` handler whose update lands in a
  `setTimeout`, and ngx-infinite-scroll's `zone.run(emit)` + timer append all
  paint. The same page in zoneless mode paints none of these (control run).
- [x] Dev (`absolute dev`): same results; "Angular hydrated 1 component(s)";
  zone.js served unbundled before Angular.
- [x] Dev HMR tier 0 (template edit): applied in 3–11ms, no reload, instance
  state kept, zone change detection still runs afterwards.
- [x] Tier 1a remount (field added): applied, no reload, zone change detection
  still runs afterwards.
- [x] React page and Elysia routes on the same server keep working.

## Risks

1. Process-wide patching. zone.js patches `Promise`, timers, `EventEmitter`,
   `fs` callbacks and more for the whole server, including React/Svelte/Vue
   SSR and user code. Phase 1 only fixes the one Bun incompatibility it found
   (`Bun.serve`). Other Bun APIs that require a native Promise from a
   callback could fail the same silent way. Nothing failed in the e2e runs,
   including dev builds (`Bun.build` plugins) and HMR.
2. Third-party code with native `async` is not downleveled. Only the app's
   Angular sources go through `downlevelAsyncForZone`; Angular's own FESM
   bundles and libraries in `node_modules` keep native `async`. The Angular CLI
   downlevels those too. Most Angular internals use `PendingTasks` for SSR
   stability, so this mostly affects libraries that `await` before setting
   state.
3. Production client evaluation order. In production the client index bundles
   zone.js inline, while the Angular vendor chunks are separate ES modules that
   evaluate first. Angular reads `Zone` lazily (at `NgZone` construction), so
   this works today, but anything that captures `Promise` or patches
   `EventTarget` at module evaluation would see the unpatched globals. Dev
   serves zone.js as the first module, so dev is not affected.
4. Downleveling changes class-field semantics to assignment
   (`useDefineForClassFields: false`), which is what Angular expects, adds
   inline helpers per file, and turns `#private` fields into WeakMaps.
5. Islands stay zoneless and log NG0914 in dev when zone.js is loaded.
6. `fastHmrCompiler` update modules keep native `async`, so a method changed
   through HMR loses zone tracking after its first `await` until a full
   reload.
7. Standalone executables (`absolute compile`): `zone.js/node` is imported
   from a runtime specifier and is not embedded.
8. Dev JIT does not see signal queries (`viewChild.required(...)`): NG0951 in
   `ngAfterViewInit` in dev. Unrelated to zone mode, but zone apps hit it
   because they use `ngAfterViewInit`. The e2e page uses `@ViewChild`.

## Phase 2: correctness gaps

- Vendor zone.js as its own browser module imported first (Angular vendor or
  dep vendor), so production evaluation order matches dev and the CLI's
  polyfills order.
- Downlevel `async` in `fastHmrCompiler` update modules in zone mode.
- Wrap `remountComponentClass` work in `NgZone.run` (harmless under
  NoopNgZone) so remounted listeners are always created in the Angular zone.
- Angular islands: follow the page mode (zone islands in zone apps), or at
  least suppress NG0914.
- Verify `@defer`, streaming slots and server islands in zone mode.
- `absolute add angular`: add zone.js and the config key when asked for zone
  mode.

Exit criteria: e2e covering a production page with `@defer` + a streaming slot +
an Angular island in zone mode; an HMR edit to an `async` method keeps zone
tracking; no NG0914 in dev.

## Phase 3: hardening the server patch

- Audit Bun APIs that take callbacks returning promises (`Bun.build` plugin
  hooks, `Bun.serve` websocket handlers, `Bun.spawn` hooks, `bun:sqlite`,
  `Bun.file().stream` sources) under zone.js; wrap any that reject
  ZoneAwarePromise.
- Option: downlevel `async` in Angular-related vendor packages and libraries
  (as the CLI does), behind a flag, with a build-time cost measurement.
- A per-page opt-in (zone for some pages only) is possible because zoneless
  pages run fine with zone.js loaded; decide whether to expose it.

Exit criteria: full Angular integration suite and the example app passing with
`changeDetection: 'zone'`; benchmark of SSR throughput zone vs zoneless.

## Phase 4: docs and packaging

- Add `zone.js` as an optional peer dependency in `package.json`
  (`"peerDependencies": { "zone.js": "~0.16.0" }`,
  `"peerDependenciesMeta": { "zone.js": { "optional": true } }`). Not changed
  in Phase 1 (shared file); zone.js is already in `scripts/build.ts`'s external
  list.
- User docs: when to choose zone mode, the async downleveling, `HttpClient`
  vs raw `fetch`, islands behaviour.

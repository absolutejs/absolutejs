# Surgical Angular HMR — current state

This file documents the production architecture as of
`@absolutejs/absolute@0.19.0-beta.857` (will bump shortly).

For the design rationale and history, see git log on this file
(prior versions captured the spike + multi-phase design); for the
why-Angular-doesn't-already-do-this writeup, see
`ANGULAR_HMR_ARCHITECTURE.md`.

## Tier model

Three tiers, picked per HMR cycle by `decideAngularTier` in
`src/dev/rebuildTrigger.ts`:

| Tier | Trigger | Mechanism | Cost | State preserved |
|---|---|---|---|---|
| 0 | `tryFastHmr` returns `ok: true` for every affected entity | `ɵɵreplaceMetadata` + prototype patch | ~150ms | yes |
| 1 | `tryFastHmr` bails on any entity (most often: structural fingerprint mismatch) | `ApplicationRef.destroy()` + `bootstrapApplication` | ~1–2s | no Angular state, browser session yes |
| 2 | Server tells client `'full-reload'` | `window.location.reload()` | depends on bundle | no |

Tier 2 is the existing `'full-reload'` path; we don't trigger it
ourselves — it's reserved for cases where the bundle structure
breaks (new pages added, page-entry restructure).

## What Tier 0 covers

- **Components** (`@Component`):
  - Template / style edits → `ɵɵreplaceMetadata` updates `ɵcmp`,
    Angular re-renders all views with the new template.
  - Method body edits → prototype patch (`Class.prototype.method = newFn`)
    for every method declared on the class. Existing instances inherit
    new methods via prototype chain.
  - Static method edits → patched onto the class itself.
  - Adding signal-form / decorator-form inputs/outputs → fingerprint
    captures the input/output name list; renames force Tier 1, but
    body changes within an existing input/output stay Tier 0.
  - Adding a directive/pipe to `imports: [...]` → Tier 0 (the
    `dependencies: [...]` array in the new IR does the work).
- **Pipes** (`@Pipe`): method body edits via prototype patch.
  Pipe-name / `pure` flag changes → Tier 1.
- **Directives** (`@Directive`): method body edits via prototype
  patch. Selector / inputs / outputs changes → Tier 1.
- **Services** (`@Injectable`): method body edits via prototype
  patch. Constructor / providedIn / useFactory changes → Tier 1.

## What forces Tier 1

The fingerprint (in `fastHmrCompiler.ts:extractFingerprint`)
captures the structural surface of each entity. Mismatch → Tier 1:

- **Constructor parameter type list** changes
- **Selector** (component / directive) changes
- **`standalone` flag** flips
- **Input / output name lists** change
- **`@Component({ providers, viewProviders })`** presence flips
- **Arrow-function (or function-expression) class field initializer
  bodies** change (per-instance state that prototype patching can't
  touch)
- **`imports: [...]`** gains/loses a provider-bearing entry
  (NgModule with `providers`, or any bare-specifier import named
  `*Module` per heuristic)
- **Member decorators** other than `@Input`/`@Output` are
  added/removed/arg-changed (`@HostBinding`, `@HostListener`,
  `@ViewChild`, `@ContentChild`, `@ViewChildren`, `@ContentChildren`,
  etc.). Body edits inside an existing handler stay Tier 0 via
  prototype patch.

## What still silently no-ops (known limitations)

These edits don't fingerprint-trigger and the prototype patch
doesn't apply → user's edit doesn't take effect until a manual
reload or unrelated Tier 1 event:

- **Property initializer expressions** (`count = computeInitial()`):
  changing the right-hand side doesn't apply to existing instances.
  This is by design — we don't want `count = 0` → `count = 5` to
  reset live counter state.
- **`@Input` / `@Output` alias-only changes**: the fingerprint
  captures input/output *names* but not the alias values inside
  `@Input({ alias: 'foo' })`. Renaming the alias without renaming
  the property silently no-ops. Minor and rarely hit; a future
  fingerprint expansion can capture the binding-name list rather
  than just the class-property-name list.

## Per-component remount in Tier 1 — researched, deferred

Tier 1 destroys the entire `ApplicationRef` and re-bootstraps. The
React-style alternative would be: find live instances of the changed
class, surgically remount only those instances, leave siblings
untouched.

Full investigation in `ANGULAR_PER_COMPONENT_REMOUNT_RESEARCH.md`.
Short version: Angular's public API surface (`getComponent`,
`createComponent`, `applicationRef.attachView`, `viewContainerRef.createComponent`,
`runInInjectionContext`) supports root-component recreation but
not in-place destroy + recreate of a child component within its
parent's view tree. The blocker is access to the parent's
`ViewContainerRef` for the child slot, which Angular doesn't
expose. Angular CLI's HMR doesn't do per-component remount
either, for the same reason.

Tracked as deferred until either Angular ships a public hook
or dealroom usage shows Tier 1 firing too often. Current Tier 1
is correct, just wider blast radius than ideal.

## Where the bits live

- `src/dev/angular/fastHmrCompiler.ts` — surgical IR + prototype
  patch builder. Branches on entity kind for the `tryFastHmr`
  result.
- `src/dev/angular/resolveOwningComponents.ts` — resolves a
  changed file (TS or HTML/CSS resource) to the affected
  `{filePath, className, kind}` entries.
- `src/dev/angular/hmrInjectionPlugin.ts` — Bun loader plugin
  that bakes per-entity `__ng_hmr_load` listeners into the
  bundle for Component / Directive / Pipe / Injectable classes.
- `src/dev/angular/hmrCompiler.ts` — `/@ng/component?c=<id>&t=<ts>`
  endpoint dispatcher; detects entity kind, calls `tryFastHmr`
  with the right kind, falls back to ngtsc on bail.
- `src/dev/angular/hmrImportGenerator.ts` — implements
  `ImportGenerator` for the vendored translator so emitted
  modules use `globalThis.__angularHmr` (not `import.meta.hot`).
- `src/dev/angular/vendor/translator/` — vendored Angular
  `translateStatement` from compiler-cli, see `VENDORED.md`.
- `src/dev/client/handlers/angularHmrShim.ts` — runtime shim
  that registers the WS message bus on `globalThis.__angularHmr`.
- `src/dev/rebuildTrigger.ts` — `decideAngularTier`,
  `broadcastSurgical`, `broadcastRebootstrap`, the
  `handleAngularFastPath` orchestration.
- `src/dev/client/hmrClient.ts` — handles `'angular:component-update'`
  and `'angular:rebootstrap'` WS messages.
- `src/build/compileAngular.ts` — bakes the
  `__ABS_ANGULAR_REBOOTSTRAP__` hook into each page's hydration
  wrapper (used by Tier 1).

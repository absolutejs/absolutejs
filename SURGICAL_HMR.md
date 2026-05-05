# Surgical Angular HMR — current state

This file documents the production architecture as of
`@absolutejs/absolute@0.19.0-beta.908`.

For the why-Angular-doesn't-already-do-this writeup, see
`ANGULAR_HMR_ARCHITECTURE.md`. For the design history (spike +
multi-phase rollout), see `git log` on this file and
`ANGULAR_HMR.md` (the original Phase 1 / Phase 2 plan, all of which
landed under the architecture below).

## Tier model

Four tiers, picked per HMR cycle by `decideAngularTier` in
`src/dev/rebuildTrigger.ts` and `getComponentSurgicalUpdate` in
`src/dev/angular/hmrCompiler.ts`. The user-facing distinction is
"how much state survives." Tier 0/1a preserve every signal value,
form input, scroll position, modal state. Tier 1b restarts the app.
Tier 2 reloads the page.

| Tier | Trigger | Mechanism | Cost | State preserved |
|---|---|---|---|---|
| 0 fast | `tryFastHmr` builds R3 IR via single-file extractor | `ɵɵreplaceMetadata` + prototype patch | ~50–150ms | yes |
| 0 slow | Component uses advanced metadata (queries, host bindings, animations, …); fast extractor bails | `ɵɵreplaceMetadata` + prototype patch — IR built via ngc's `emitHmrUpdateModule` then rewired to our calling convention | ~150–500ms | yes |
| 1a remount | Structural fingerprint mismatch — constructor params, providers, member decorators, etc. changed | Vendored LView slot ops + public `createComponent`; destroys + recreates *only* the affected component subtree | ~300–800ms | per-component instance state lost; siblings preserved |
| 1b rebootstrap | `tryFastHmr` returns a hard error (no `@Component` decorator, parse failure, missing template/style file, etc.) | `ApplicationRef.destroy()` + `bootstrapApplication` | ~1–2s | nothing in Angular's tree; browser session yes |
| 2 full reload | Server emits `'full-reload'` | `window.location.reload()` | depends on bundle | nothing |

Tier 2 is reserved for cases where the bundle structure breaks
(new pages added, page-entry restructure). The HMR pipeline never
escalates to it on its own.

## Tier 0 fast path — `compileComponentFromMetadata` direct

`src/dev/angular/fastHmrCompiler.ts:tryFastHmr` parses the changed
`.ts` file, extracts component metadata via TS AST walks, and feeds
it to `compileComponentFromMetadata` to produce the surgical-update
module. No ngc, no shadow program — runs in ~10–50ms.

Covers the modern Angular shape:

- **Components** (`@Component`):
  - Template / style edits → `ɵɵreplaceMetadata` updates `ɵcmp`,
    Angular re-renders all views with the new template.
  - Method body edits → prototype patch (`Class.prototype.method = newFn`)
    for every method declared on the class. Existing instances inherit
    new methods via prototype chain.
  - Static method edits → patched onto the class itself.
  - Adding signal-form / decorator-form inputs/outputs → fingerprint
    captures the input/output binding-name list (alias-aware since
    `75971bc`); renames force Tier 1a, body changes within an
    existing input/output stay Tier 0.
  - `imports: [...]` adds/removes — fingerprint stays Tier 0; child
    component metadata (selector + inputs + outputs) is resolved
    from the `.ts` source for local imports and the package's
    shipped `.d.ts` (walking re-export chains for barrel modules)
    for library imports, then fed to ngc as
    `R3DirectiveDependencyMetadata` so the IR emits the proper
    `ɵɵelement` / input bindings rather than `ɵɵdomElement` /
    static DOM attrs.
- **Pipes** (`@Pipe`): method body edits via prototype patch.
  Pipe-name / `pure` flag changes → Tier 1a remount.
- **Directives** (`@Directive`): method body edits via prototype
  patch. Selector / inputs / outputs changes → Tier 1a remount.
- **Services** (`@Injectable`): method body edits via prototype
  patch. Constructor / providedIn / useFactory changes → Tier 1a.

## Tier 0 slow path — bail to ngc's `emitHmrUpdateModule`

When the fast extractor can't build a correct R3 metadata (the
component uses one of several "advanced" features whose extraction
would be hundreds of lines of TS AST per item), `tryFastHmr` bails
with `reason: 'uses-advanced-feature'` and the dispatcher routes
the same WS message to the `/@ng/component` endpoint, which falls
back to ngc's `emitHmrUpdateModule`. The result is the same Tier 0
surgical update — `ɵɵreplaceMetadata` apply with full state
preservation — just compiled by ngc instead of our extractor, so
all metadata fields are correct.

Bail conditions (`detectAdvancedComponentFeatures` in
`fastHmrCompiler.ts`):

- `@Component({ animations: [trigger(...)] })`
- `@Component({ host: { '[class.foo]': 'flag' } })`
- `@Component({ providers: [...] })`
- `@Component({ viewProviders: [...] })`
- `@Component({ exportAs: 'foo' })`
- `@Component({ hostDirectives: [...] })`
- Any class member decorated with `@HostBinding`, `@HostListener`,
  `@ViewChild`, `@ViewChildren`, `@ContentChild`, `@ContentChildren`
- Any field initializer that's a `viewChild()`, `viewChildren()`,
  `contentChild()`, or `contentChildren()` signal-query call
- Any `@Input({ transform: ... })` / `input(default, { transform })`

The slow-path module ngc emits doesn't match the calling convention
that `__ng_hmr_load` uses (it expects free-variable parameters and
multi-namespace `ɵɵnamespaces[N]` slots), so
`rewriteSlowPathLocalsToAbsDeps` in `hmrCompiler.ts` post-processes
the output:

1. **Free-variable parameters** (`function Foo_UpdateMetadata(Foo,
   ɵɵnamespaces, CommonModule, ImageComponent, …)`) → strip the
   extras and add a `const { CommonModule, ImageComponent, … } =
   Foo.__abs_deps || {};` destructure preamble.
   `hmrInjectionPlugin.ts` populates `__abs_deps` on the live class
   with every top-level identifier from the component's source
   file, so the closure resolves correctly.
2. **Multi-namespace `ɵɵnamespaces[N]` slots** (`const ɵhmr0 =
   ɵɵnamespaces[0]; const ɵhmr1 = ɵɵnamespaces[1]; … ɵhmr1.NgClass
   …`) → infer the source angular subpackage from the symbols
   referenced (`@angular/core` for `ɵhmr0` always; `@angular/common`
   when symbols match `NgClass`/`NgIf`/`AsyncPipe`/etc.; same for
   `forms`, `router`, `animations`) and replace with module-level
   `import * as ɵhmrN from '<package>';` static imports. The
   `/@ng/component` endpoint already runs `rewriteImportsInContent`
   afterwards, so the bare specifier becomes a vendor URL the
   browser can fetch.
3. **`Class.ɵfac = function …` direct assignment** → drop the line.
   Angular's compiler defines `ɵfac` as a getter on classes that
   are HMR-tracked; direct assignment throws `Cannot set property
   ɵfac of class … which has only a getter`. The existing factory
   keeps working — Tier 0's fingerprint guarantees the constructor
   signature is stable, so a fresh factory isn't needed.

## What forces Tier 1a (per-component remount)

The fingerprint (in `fastHmrCompiler.ts:extractFingerprint`)
captures the structural surface of each entity. Mismatch → Tier 1a
remount: the surgical-update module is still built (with
`fingerprintChanged: true`), but the dispatcher broadcasts
`'angular:component-remount'` instead of
`'angular:component-update'`. The client's
`__ng_hmr_remount` listener tears down each live instance via
the vendored LView slot ops in `src/dev/client/vendor/lview/` and
re-creates it via public `createComponent`, so the new constructor
runs with fresh field initializers and fresh DI.

Fingerprinted dimensions:

- **Constructor parameter type list** changes
- **Selector** (component / directive) changes
- **`standalone` flag** flips
- **Input / output binding-name lists** change (alias-aware)
- **`@Component({ providers, viewProviders })`** presence flips
- **Arrow-function (or function-expression) class field initializer
  bodies** change (per-instance state that prototype patching can't
  touch)
- **`imports: [...]`** gains/loses a provider-bearing entry
  (NgModule with `providers`, or any bare-specifier import named
  `*Module` per heuristic)
- **Member decorators** other than `@Input`/`@Output` are
  added/removed/arg-changed (`@HostBinding`, `@HostListener`,
  `@ViewChild`, `@ContentChild`, etc.). Body edits inside an
  existing handler stay Tier 0 via prototype patch.

## What forces Tier 1b (full rebootstrap)

`tryFastHmr` returning `ok: false` for a *non*-advanced-feature
reason — i.e., the file itself can't be processed:

- File not found, class not found, anonymous class
- No `@Component` / `@Directive` / `@Pipe` / `@Injectable` decorator
- Decorator args not an object literal
- Component not standalone (NgModule-based — see
  `ANGULAR_HMR_ARCHITECTURE.md` Tier 3 for why)
- Component inherits from a decorated parent class (metadata
  merging up the chain — punt to ngc fallback)
- Multiple decorators on one class
- Template parse failure
- Resource (`templateUrl` / `styleUrls`) file missing on disk

Tier 1b broadcasts `'angular:rebootstrap'`. The page's hydration
wrapper (built by `compileAngular.ts`) installs an
`__ABS_ANGULAR_REBOOTSTRAP__` hook that calls
`ApplicationRef.destroy()` and re-runs `bootstrapApplication` with
the latest module bytes from disk.

## moduleServer-driven dev pipeline

In dev (`hmr=true`), Angular pages are NOT bundled by `Bun.build`.
Instead:

- `compileAngular` runs once at startup (and on Tier 1b
  rebootstrap) to JIT-transpile every page's `.ts` source +
  recursive imports into `.absolutejs/generated/angular/`. Each
  emitted `.component.js` keeps `templateUrl: '...'` inlined as a
  template string and references its peers via on-disk relative
  imports.
- `moduleServer` (`src/dev/moduleServer.ts`) serves those files at
  `/@src/.absolutejs/generated/angular/...`. For every
  `*.component.js` request it appends the per-class HMR listener
  block via `applyAngularHmrInjection` (the same transform that
  used to run as a Bun loader plugin at bundle time).
- `runAngularHmrIncremental` in `rebuildTrigger.ts` runs two
  parallel passes per HMR cycle:
  1. **ngc shadow program** (via `compileAngularForHmr`) keeps the
     incremental `getCachedHmrProgram()` fresh so `/@ng/component`
     can serve the slow-path module on demand. Seeded with every
     page entry under `<angularDir>/pages/` (cached, invalidated on
     `.ts` edits).
  2. **JIT disk-refresh** (via `compileAngularFileJIT`) re-emits
     the edited `.component.js` (or its owning `.component.ts`
     when an HTML/CSS resource changes) into
     `.absolutejs/generated/angular/...` and calls
     `invalidateModule` on the result — moduleServer's transform
     cache is hard-denied by the file watcher, so writes inside
     `.absolutejs/` need explicit invalidation. Without this, a
     hard refresh during editing would boot from the stale
     pre-edit module.

`cleanup({ preserveAngularGenerated: true })` runs at the end of
every dev build so the `.absolutejs/generated/angular/` tree
moduleServer is serving from doesn't get wiped.

The `bun:wrap` virtual module (Bun's TS transpiler emits
`import { __legacyDecorateClassTS, __legacyMetadataTS } from
"bun:wrap";` for every legacy-decorator class — i.e., every
Angular component) is served by moduleServer as a virtual ESM
module exporting the standard TypeScript runtime helpers. Without
this the import leaks through as `/@src/bun:wrap` with empty MIME
and crashes the module-script load.

`node:*` and bare-builtin specifiers (`fs`, `path`, `url`, …) are
detected upfront in `moduleServer.resolveAbsoluteSpecifier` and
routed to `/@stub/<name>` (noop module) instead of through Bun's
resolver, which would otherwise return the bare spec unchanged
and produce another empty-MIME `/@src/node:path` 0-byte response.
Server-only code (e.g., `imageProcessing.ts`) that transitively
ends up in a browser bundle still loads — the calls just become
no-ops.

## SSR Angular core multi-instance guardrail

`NG0203` ("the `<Token>` token injection failed") is what the SSR
runtime throws when two distinct `@angular/core` module instances
load and `inject()` reads `currentInjector` from the wrong one.
The §1.1 fix pins SSR to a single resolution path. The
`verifyAngularCoreUniqueness` build-time check
(`src/build/verifyAngularCoreUniqueness.ts`, registered as
`tracePhase('verify/angular-core-uniqueness', …)` after the
post-build vendor rewrite) is the regression guardrail:

- Walks every server bundle's import statements
- Classifies each `@angular/core` reference as either `bare`
  (Bun's runtime resolver dedupes these) or `resolved` (a concrete
  file path — vendor build output, transpiler-emitted absolute,
  etc.; two artifacts pointing at distinct canonical paths become
  two `currentInjector` globals)
- Fails the build (or warns on incremental runs) when more than
  one distinct shape is found, with a per-shape breakdown listing
  up to 3 referencing artifact paths

Detection covers both the package-style path (`@angular/core/...`)
and the vendor file naming convention from
`buildAngularVendor.ts:toSafeFileName` (`angular_core.js`).

## Where the bits live

- `src/dev/angular/fastHmrCompiler.ts` — fast-path R3 IR builder
  + prototype patch generator + advanced-feature bail detector.
  Branches on entity kind for the `tryFastHmr` result.
- `src/dev/angular/resolveOwningComponents.ts` — resolves a
  changed file (TS or HTML/CSS resource) to the affected
  `{filePath, className, kind}` entries via an inverted index of
  `templateUrl` / `styleUrls` → owning component.
- `src/dev/angular/hmrInjectionPlugin.ts` — emits the per-class
  `__ng_hmr_load` / `__ng_hmr_remount` listeners + the
  `__abs_deps` registry into every Angular `.component.js`.
  Used by both the Bun loader plugin (initial bundle) and
  moduleServer (per-request transform).
- `src/dev/angular/hmrCompiler.ts` — `/@ng/component?c=<id>&t=<ts>`
  endpoint dispatcher; tries `tryFastHmr`, falls back to ngc's
  `emitHmrUpdateModule`, post-processes the slow-path output to
  match `__ng_hmr_load`'s calling convention.
- `src/dev/angular/hmrImportGenerator.ts` — implements
  `ImportGenerator` for the vendored translator so emitted
  modules use `globalThis.__angularHmr` (not `import.meta.hot`).
- `src/dev/angular/vendor/translator/` — vendored Angular
  `translateStatement` from compiler-cli. See `VENDORED.md`.
- `src/dev/client/handlers/angularHmrShim.ts` — runtime shim
  that registers the WS message bus on `globalThis.__angularHmr`.
- `src/dev/client/handlers/angularRemount.ts` +
  `angularRemountWiring.ts` — Tier 1a per-component destroy +
  recreate using the vendored LView slot ops.
- `src/dev/client/vendor/lview/` — vendored LView / LContainer
  slot constants and operations from `@angular/core`'s render3
  internals. Locked to a specific Angular minor; refresh on every
  Angular update like the translator.
- `src/dev/rebuildTrigger.ts` — `decideAngularTier`,
  `runAngularHmrIncremental` (parallel ngc-shadow + JIT
  disk-refresh), `broadcastSurgical`, `broadcastRemount`,
  `broadcastRebootstrap`, the `handleAngularFastPath`
  orchestration.
- `src/dev/moduleServer.ts` — on-demand `.ts`/`.component.js`
  transformer; appends `applyAngularHmrInjection` per request,
  serves the `bun:wrap` virtual module, stubs `node:*` builtins.
- `src/dev/client/hmrClient.ts` — WS message handler. Routes
  `'angular:component-update'` / `'angular:component-remount'` /
  `'angular:rebootstrap'` to the appropriate dispatch.
- `src/build/compileAngular.ts` — JIT page transpile +
  `__ABS_ANGULAR_REBOOTSTRAP__` hook generation. `cacheBuster`
  forces rewrite of the *entry* file only (not its recursive
  imports) so HTML/CSS-only edits propagate without thrashing the
  whole import graph.
- `src/build/verifyAngularCoreUniqueness.ts` — §3.4 build-time
  guardrail.
- `src/utils/cleanup.ts` — `preserveAngularGenerated` flag keeps
  `.absolutejs/generated/angular/` alive in dev when moduleServer
  is serving from it.

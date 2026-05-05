# Surgical Angular HMR — current state

This file documents the production architecture as of
`@absolutejs/absolute@0.19.0-beta.913`.

For the why-Angular-doesn't-already-do-this writeup, see
`ANGULAR_HMR_ARCHITECTURE.md`. For the design history (spike +
multi-phase rollout), see `git log` on this file and
`ANGULAR_HMR.md` (the original Phase 1 / Phase 2 plan, all of which
landed under the architecture below).

## Tier model

Three tiers, picked per HMR cycle by `decideAngularTier` in
`src/dev/rebuildTrigger.ts`. The user-facing distinction is "how
much state survives." Tier 0 / Tier 1a preserve every signal value,
form input, scroll position, modal state. Tier 1b restarts the app.
Tier 2 reloads the page.

| Tier | Trigger | Mechanism | Cost | State preserved |
|---|---|---|---|---|
| 0 | `tryFastHmr` returns `ok: true` and the structural fingerprint matches | `ɵɵreplaceMetadata` + prototype patch | ~50–350ms | yes |
| 1a remount | `tryFastHmr` returns `ok: true` and the structural fingerprint mismatched (constructor params, providers, member decorators, etc.) | Vendored LView slot ops + public `createComponent`; destroys + recreates *only* the affected component subtree | ~300–800ms | per-component instance state lost; siblings preserved |
| 1b rebootstrap | `tryFastHmr` returns `ok: false` (no `@Component` decorator, parse failure, missing template/style file, multiple decorators on one class, inheritance from a decorated parent, …) | `ApplicationRef.destroy()` + `bootstrapApplication` | ~1–2s | nothing in Angular's tree; browser session yes |
| 2 reload | Server emits `'full-reload'` | `window.location.reload()` | depends on bundle | nothing |

Tier 2 is reserved for bundle-shape changes (new pages, page-entry
restructure). The HMR pipeline never escalates to it on its own.

## Tier 0 — `compileComponentFromMetadata` direct

`src/dev/angular/fastHmrCompiler.ts:tryFastHmr` parses the changed
`.ts` file, extracts component metadata via TS AST walks, and feeds
it to Angular's `compileComponentFromMetadata` to produce the
surgical-update module. No ngc, no shadow program, no transitive
analysis — this runs in ~10–50ms regardless of project size.

The covered metadata surface is now the full `@Component` shape
that AOT supports:

- **Template / styles / `templateUrl` / `styleUrls`** — inlined into
  the IR via `parseTemplate` and `collectStyles`.
- **`imports: [...]`** — child component metadata (selector, inputs,
  outputs, isComponent) resolved from the `.ts` source for local
  imports and the package's shipped `.d.ts` for library imports
  (walking re-export chains for barrel modules), then fed to ngc as
  `R3DirectiveDependencyMetadata`. Without this, ngc takes the
  DOM-only emit path (`ɵɵdomElement`) and child components like
  `<abs-image>` lose their input bindings on `ɵɵreplaceMetadata`.
- **`@Input()` / `@Output()`** — decorator and signal forms; alias-
  aware (`@Input({ alias })`, `input(default, { alias })`).
- **`@Input({ transform })` / `input(default, { transform })`** —
  `transformFunction` wrapped as `WrappedNodeExpr` of the original
  AST node; runtime evaluates it in the surgical-update module's
  scope (where the imported transform identifier resolves via
  `__abs_deps`).
- **`animations: [trigger(...), ...]`** — opaque `Expression`,
  `WrappedNodeExpr` pass-through. The `trigger` / `state` / `style`
  / `transition` identifiers resolve via `__abs_deps`.
- **`host: { '[class.foo]': 'flag', '(click)': 'onClick($event)' }`** —
  parsed into `R3HostMetadata.properties` / `listeners` /
  `attributes` based on key shape. Plain attribute values are
  wrapped as `WrappedNodeExpr`.
- **`@HostBinding('class.foo') prop`** — merged into
  `R3HostMetadata.properties`.
- **`@HostListener('click', ['$event']) onClick(e) {}`** — merged
  into `R3HostMetadata.listeners`.
- **`@ViewChild` / `@ViewChildren` / `@ContentChild` / `@ContentChildren`**
  — `R3QueryMetadata` with the static-attr / descendants / read /
  emitDistinctChangesOnly options preserved. Token args wrapped as
  `WrappedNodeExpr`; string args become predicate string lists.
- **`viewChild()` / `viewChildren()` / `contentChild()` /
  `contentChildren()`** (plus their `.required()` chained variant) —
  `R3QueryMetadata` with `isSignal: true`.
- **`providers: [...]` / `viewProviders: [...]`** — opaque
  `Expression`, `WrappedNodeExpr` pass-through. Provider list-item
  changes apply on the next surgical cycle without falling out of
  Tier 0.
- **`exportAs: 'foo'` / `exportAs: ['foo', 'bar']`** — `string[]`.
- **`hostDirectives: [Class, { directive, inputs, outputs }]`** —
  `R3HostDirectiveMetadata[]`; entries' `directive` references
  wrapped as `WrappedNodeExpr`, inputs/outputs maps parsed from
  `'name: alias'` strings.

For non-component entities:

- **Pipes** (`@Pipe`) — method body edits via prototype patch; pipe
  name / `pure` flag changes flip the fingerprint and force Tier 1a
  remount.
- **Directives** (`@Directive`) — method body edits via prototype
  patch; selector / inputs / outputs changes force Tier 1a.
- **Services** (`@Injectable`) — method body edits via prototype
  patch; constructor / `providedIn` / `useFactory` changes force
  Tier 1a.

The opaque-`WrappedNodeExpr` fields (`animations`, `providers`,
`viewProviders`, `host.attributes`) all reference imported
identifiers from the user's source file. `hmrInjectionPlugin.ts`
populates `${ClassName}.__abs_deps` with every top-level
identifier from the source's import list, and the surgical-update
module destructures them at the top of its function body — so
the wrapped expressions resolve correctly when ɵɵreplaceMetadata
applies the new IR.

## What forces Tier 1a (per-component remount)

The fingerprint (in `fastHmrCompiler.ts:extractFingerprint`) captures
the structural surface of each entity. Mismatch → Tier 1a remount:
the surgical-update module is still built (with `fingerprintChanged:
true`), but the dispatcher broadcasts `'angular:component-remount'`
instead of `'angular:component-update'`. The client's
`__ng_hmr_remount` listener tears down each live instance via the
vendored LView slot ops in `src/dev/client/vendor/lview/` and
re-creates it via public `createComponent`, so the new constructor
runs with fresh field initializers and fresh DI.

Fingerprinted dimensions:

- Constructor parameter type list changes
- Selector (component / directive) changes
- `standalone` flag flips
- Input / output binding-name lists change (alias-aware)
- `@Component({ providers, viewProviders })` presence flips
- Arrow-function (or function-expression) class field initializer
  bodies change (per-instance state that prototype patching can't
  touch)
- `imports: [...]` gains/loses a provider-bearing entry (NgModule
  with `providers`, or any bare-specifier import named `*Module`
  per heuristic)
- Member decorators other than `@Input`/`@Output` are
  added/removed/arg-changed (`@HostBinding`, `@HostListener`,
  `@ViewChild`, `@ContentChild`, etc.). Body edits inside an
  existing handler stay Tier 0 via prototype patch.

## What forces Tier 1b (full rebootstrap)

`tryFastHmr` returning `ok: false` for a structural reason — i.e.,
the file itself can't be parsed:

- File not found, class not found, anonymous class
- No `@Component` / `@Directive` / `@Pipe` / `@Injectable` decorator
- Decorator args not an object literal
- Component not standalone (NgModule-based — see
  `ANGULAR_HMR_ARCHITECTURE.md` Tier 3 for why)
- Component inherits from a decorated parent class (metadata
  merging up the chain — punted)
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
- `runAngularHmrIncremental` in `rebuildTrigger.ts` re-emits the
  edited `.component.js` (or its owning `.component.ts` when an
  HTML/CSS resource changes) into `.absolutejs/generated/angular/...`
  via `compileAngularFileJIT` and calls `invalidateModule` on the
  result — moduleServer's transform cache is hard-denied by the
  file watcher, so writes inside `.absolutejs/` need explicit
  invalidation. Without this, a hard refresh during editing would
  boot from the stale pre-edit module.

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
The §1.1 fix (in `ANGULAR_HMR.md`) pins SSR to a single resolution
path. The `verifyAngularCoreUniqueness` build-time check
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

- `src/dev/angular/fastHmrCompiler.ts` — the entire surgical-update
  builder. Parses the user's `.ts`, walks AST decorators / signal-
  initializer calls / member decorators to extract a complete
  `R3ComponentMetadata`, calls `compileComponentFromMetadata` to
  produce the surgical IR, runs the prototype patch generator,
  emits the final module text. No ngc, no shadow program.
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
  endpoint dispatcher: decodes the id, resolves the owning class,
  calls `tryFastHmr`, returns its module text or `null`. Returns
  `null` on any failure — the dispatcher in `rebuildTrigger.ts`
  has already escalated those cases to Tier 1b before the endpoint
  is hit.
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
  `runAngularHmrIncremental` (JIT disk-refresh only),
  `broadcastSurgical`, `broadcastRemount`,
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

# AbsoluteJS Angular HMR

A reference description of how AbsoluteJS implements hot module
replacement for Angular components, the techniques that produce
sub-50 ms end-to-end edit latency, and the architectural
difference from `@angular/build`-driven HMR.

Available in `@absolutejs/absolute@0.19.0-beta.915` and later.

---

## 1. Overview

Angular ships an HMR runtime primitive, `ɵɵreplaceMetadata`,
which atomically substitutes a component's compiled definition
on the live class while the application keeps running. Every
Angular HMR implementation — `@angular/build` (the official
esbuild builder), `@analogjs/vite-plugin-angular`, AbsoluteJS —
ultimately invokes the same primitive. The differences between
implementations are upstream of the call: how the new
`R3ComponentMetadata` is produced.

The mainstream path runs ngtsc's incremental compilation on
every edit. Incremental compilation includes template
type-checking via the type-check block (TCB), which on
non-trivial projects dominates the wall-clock cost.

AbsoluteJS produces the metadata without invoking ngtsc:

1. Parse the changed file with the TypeScript compiler API
   (single file, no program).
2. Walk the AST to extract `R3ComponentMetadata`.
3. Hand it to `@angular/compiler`'s
   `compileComponentFromMetadata` (the IR builder Angular itself
   uses during AOT).
4. Translate the resulting statements to module text and broadcast.

Type-checking is delegated to the editor's TypeScript Language
Server and to a separate `tsc --watch` process if the project
runs one. The HMR pipeline does not duplicate that work.

---

## 2. Benchmark results

Project: 3 standalone Angular components (root page,
inline-template `HeaderComponent`, `templateUrl` + `styleUrl`
`CounterComponent`).

Stack: `@absolutejs/absolute@0.19.0-beta.915`, `@angular/* 21.2.11`,
Bun 1.3.13, Linux/WSL2.

Methodology: a Bun client connects to the dev server's `/hmr`
WebSocket, performs scripted text replacements on each fixture
file (apply / revert alternating), and records two values per
iteration:

- **Server-side dispatch**: parsed from the dev server's own
  `[ng-hmr]` (or `[hmr] css update`) log line.
- **End-to-end**: time from `fs.writeFile` resolving until the
  matching HMR broadcast arrives on the client WebSocket.

N = 30 samples per case, plus 3 warmup iterations not counted.

| Case                                   | Tier         | Server p50 | Server p95 | Server max | E2E p50 | E2E p95 | E2E max |
|----------------------------------------|--------------|------------|------------|------------|---------|---------|---------|
| TS method body                         | 0            | 13 ms      | 16 ms      | 18 ms      | 43 ms   | 48 ms   | 79 ms   |
| Inline template literal in `@Component`| 0            | 12 ms      | 15 ms      | 18 ms      | 43 ms   | 53 ms   | 108 ms  |
| External `templateUrl` `.html`         | 0            | 12 ms      | 19 ms      | 19 ms      | 43 ms   | 51 ms   | 59 ms   |
| External `styleUrl` `.css`             | css-update*  | 72 ms      | 92 ms      | 93 ms      | 105 ms  | 125 ms  | 126 ms  |
| Add `@Input` (structural change)       | 1a           | 14 ms      | 20 ms      | 20 ms      | 45 ms   | 56 ms   | 68 ms   |

\* External `.css` edits go through the framework-wide CSS HMR
path (stylesheet swap), not Angular's metadata-replacement path.
See §6 for tier definitions and §10.4 for the rationale.

The server-side column is the cost of producing and broadcasting
the new metadata. The end-to-end column adds file-watcher
debounce, dev-server WebSocket frame handling, and the
localhost roundtrip — pipeline overhead that exists for any
HMR system at any speed.

The bench harness is committed at `benchmarks/angular-hmr/`. See
§11 for instructions.

---

## 3. The Angular HMR runtime primitive

`ɵɵreplaceMetadata` is exported from `@angular/core`'s render3
internals (typed `@private` but stable across recent minors).
Its callers fetch a per-class update payload — typically as an
ES module — and invoke it.

```ts
ɵɵreplaceMetadata(type, applyMetadata, namespaces, locals, importMeta, id);
```

Internally it:

1. Calls `applyMetadata(type, namespaces, ...locals)`. This is
   the recompilation step: the payload module typically calls
   `compileComponentFromMetadata` on a fresh `R3ComponentMetadata`
   describing the new state of the component.
2. Reads the resulting `ɵcmp` definition off the class.
3. Calls `mergeWithExistingDefinition(currentDef, newDef)` —
   which copies most fields from `newDef` onto `currentDef`
   *but explicitly preserves* `directiveDefs`, `pipeDefs`,
   `setInput`, and `type`.
4. Walks all live `LView`s of the affected component and
   recreates each one against the new `tView`.

The merge step in (3) is load-bearing for the AbsoluteJS
implementation. It means the HMR payload doesn't need to
reproduce the original component's directive/pipe scope;
whatever scope was established at the initial bundle's
`bootstrapApplication` time survives subsequent metadata
replacements.

---

## 4. How `@angular/build` drives the primitive

Default since Angular 17 (esbuild builder), `--hmr` since 18,
HMR-on-by-default since 20. On each edit:

1. esbuild's watcher reports the changed file.
2. ngtsc runs an incremental analysis: re-analyzes the edited
   files plus reachable dependents, runs the TCB for affected
   components, regenerates any changed `.d.ts` shapes.
3. esbuild re-emits the affected JS modules.
4. The dev server broadcasts an HMR payload that the in-page
   Angular HMR runtime decodes and feeds to `ɵɵreplaceMetadata`.

The TCB step generates a synthetic TS expression for every
binding in every affected template and submits them to the TS
program for type-checking. The cost scales with template size
and reachable directive dependencies.

`@analogjs/vite-plugin-angular` follows the same pattern with
Vite as the file-watcher / dev server, and continues to call
ngtsc for the Angular compile step. The TCB cost is the same.

---

## 5. The AbsoluteJS approach

The fast path in `src/dev/angular/fastHmrCompiler.ts` exposes
`tryFastHmr({ componentFilePath, className, kind })`:

1. **Parse** the source file with `ts.createSourceFile` (no
   program).
2. **Find** the class declaration with the requested name.
3. **Extract** `R3ComponentMetadata` via AST walks — see §7 for
   the covered surface.
4. **Compile** by calling `compileComponentFromMetadata` against
   `@angular/compiler`'s built-in `ConstantPool` and binding
   parser.
5. **Translate** the resulting statement list to module text via
   a vendored copy of Angular's `translateStatement`.
6. **Emit** the module with a leading `__abs_deps` destructure
   (see §7.3) and a default-exported function matching the
   `applyMetadata` signature `ɵɵreplaceMetadata` expects.

If any step fails — file not parseable, class not found, no
recognized decorator, parent class with its own decorator — the
caller falls back to one of the higher tiers (§6).

---

## 6. Tier model

The dispatcher in `src/dev/rebuildTrigger.ts:decideAngularTier`
classifies each affected component per edit and broadcasts one
of four message types.

| Tier | Trigger                                                                          | Mechanism                                                                                  | State preserved                                          |
|------|----------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|----------------------------------------------------------|
| 0    | `tryFastHmr` succeeds AND structural fingerprint matches the previous successful HMR | `ɵɵreplaceMetadata` against the live class                                                 | All component instance state                             |
| 1a   | `tryFastHmr` succeeds AND fingerprint changed                                    | Per-component remount via vendored LView slot ops + public `createComponent`               | Sibling components only; the affected instance is rebuilt |
| 1b   | `tryFastHmr` returns `ok: false` for a non-recoverable reason                    | `ApplicationRef.destroy()` + `bootstrapApplication`                                        | Browser session, but no Angular state                    |
| 2    | Bundle-shape change (new page, page-entry restructure)                           | Full page reload                                                                           | None                                                     |

A separate failure mode is exposed for user-fixable errors
(template parse failure, missing `templateUrl` file, missing
`styleUrls` entry). Those route to the framework's
`rebuild-error` overlay instead of triggering Tier 1b. The dev
server holds in that state until the next save resolves the
issue, at which point a successful Tier 0/1a broadcast
auto-dismisses the overlay.

The structural fingerprint compared between cycles captures:

- Constructor parameter type list
- Selector and `standalone` flag
- Input / output binding-name lists (alias-aware)
- Presence of `providers` / `viewProviders` on the decorator
- Provider import signature (sorted markers for `imports: [...]`
  entries whose source is an `@NgModule` carrying `providers`)
- Member decorator signatures (excluding `@Input`/`@Output`,
  which are captured via the binding-name lists)
- Per-instance arrow-function field initializer hashes (since
  prototype patching cannot propagate arrow-field bodies to
  existing instances)

Body edits to methods and template/style edits leave the
fingerprint unchanged and stay on Tier 0. Anything that affects
DI tree shape, instance-shape, or binding contracts shifts the
fingerprint and forces Tier 1a.

---

## 7. Metadata extraction techniques

### 7.1 `compileComponentFromMetadata` is callable in isolation

`@angular/compiler` exports the same IR builder Angular's AOT
pipeline calls. Given a populated `R3ComponentMetadata`, a
`ConstantPool`, and a `BindingParser`, it produces an
`R3CompiledExpression` containing the new component definition.
No TS program is required and no cross-file analysis is
performed. The resulting expression is fed to a translator to
produce the module text used as the HMR payload.

### 7.2 `WrappedNodeExpr` defers identifier resolution to runtime

`R3ComponentMetadata` includes fields that take an arbitrary
`Expression`: `animations`, `providers`, `viewProviders`,
`host.attributes`, `hostDirectives[].directive`,
`R3QueryMetadata.predicate`, `R3InputMetadata.transformFunction`,
and others. `WrappedNodeExpr` is the IR's escape hatch for
opaque expressions: it holds an arbitrary TypeScript AST node,
which the translator emits verbatim into the generated module.

The HMR pipeline never resolves identifiers like `trigger`,
`MyService`, or `numberAttribute` at extraction time. It hands
the user's TS AST nodes through unchanged. Resolution happens
at module-evaluation time in the browser.

### 7.3 The `__abs_deps` registry

The HMR payload module references identifiers from the user
component's source file. An import-resolution roundtrip on
every HMR cycle would be wasted work — the imports almost never
change between edits.

The `hmrInjectionPlugin` runs at initial bundle time on every
Angular component file. Alongside the user's exports, it emits:

```js
ComponentName.__abs_deps = { TriggerFn, MyService, ... };
```

containing every top-level binding of the source file's import
list. The HMR payload destructures from this static property at
the top of its function body. Identity is stable across HMR
cycles.

### 7.4 Directive scope preservation via `mergeWithExistingDefinition`

Per §3, `ɵɵreplaceMetadata` preserves the original definition's
`directiveDefs` and `pipeDefs` from the initial bundle. Those
were populated by Angular's standard scope analysis at
bootstrap — for standalone components from their `imports: [...]`
list, for non-standalone components from their containing
NgModule's `declarations`.

The HMR pipeline does not need to reproduce NgModule scope
analysis on every cycle. For standalone components it builds
an `R3DirectiveDependencyMetadata[]` from the `imports` array
(§7.5). For non-standalone components it leaves the new
metadata's declarations empty; the merge step preserves the
existing scope, and the runtime uses it to resolve template
references.

### 7.5 `R3DirectiveDependencyMetadata` for standalone imports

Angular's IR compiler picks template instructions based on
`R3ComponentMetadata.declarations` and the `isStandalone` /
`hasDirectiveDependencies` flags:

```ts
const compilationMode =
    meta.isStandalone && !meta.hasDirectiveDependencies
        ? TemplateCompilationMode.DomOnly
        : TemplateCompilationMode.Full;
```

`DomOnly` mode emits `ɵɵdomElement` instructions that don't
consult `directiveDefs`. `Full` mode emits `ɵɵelement` and
does. For standalone components, the HMR pipeline therefore
must populate `declarations` with at least one
`R3DirectiveDependencyMetadata` so the compiler picks `Full`
mode and the template's static-attribute-to-input encoding
works correctly (e.g. `<my-comp src="literal">` → input
binding rather than DOM attribute).

For each entry in the user's `imports: [...]` array, the
pipeline resolves it to:

- A project-local `.ts` source: parse the source file, locate
  the class, read decorator metadata directly.
- A library `.d.ts` shipped declaration: walk the package's
  re-export barrels, locate the exported `ɵcmp` / `ɵdir` /
  `ɵpipe` static, read selector / inputs / outputs from there.

For non-standalone components the dependency list stays empty;
`isStandalone: false` forces `Full` mode regardless, and the
preserved `directiveDefs` from the initial bundle covers
template resolution.

### 7.6 Decorator-aware inheritance handling

Angular merges metadata up the heritage chain only when the
parent class itself carries `@Component`, `@Directive`, `@Pipe`,
or `@Injectable`. Plain `class Foo extends BaseUtility` (no
parent decorator) requires no metadata merging — the prototype
chain handles method inheritance and the child's own
`R3ComponentMetadata` is sufficient.

The HMR pipeline resolves the parent class identifier through
the source file's import list:

- Same-file parent: scan the AST.
- Cross-file project-local parent: walk the import declaration,
  resolve to a `.ts` source, parse, locate the class.
- Bare-specifier (node_modules) parent: bail conservatively
  (could be decorated; library metadata-merging not implemented).

Only when the resolved parent has an Angular decorator does the
pipeline fall back to Tier 1b. Most `extends` cases stay on
Tier 0.

### 7.7 Decorator and signal-form coverage

The AST walks cover both decorator and signal-based forms for
inputs, outputs, queries, and host bindings:

- `@Input` / `@Output` (decorator form, alias-aware via
  `@Input({ alias: 'foo' })`).
- `input(default, { alias })`, `input.required(...)` /
  `output(...)` / `model(...)` (signal form, detected by
  initializer call to a known `@angular/core` symbol).
- `@HostBinding('class.foo') prop` and `@HostListener('click', [...])
  onClick(e)` — merged into `R3HostMetadata.properties` /
  `listeners`.
- `@ViewChild` / `@ViewChildren` / `@ContentChild` /
  `@ContentChildren` — `R3QueryMetadata` with
  `static`/`descendants`/`read`/`emitDistinctChangesOnly`
  preserved. Token args wrapped as `WrappedNodeExpr`; string
  args become predicate string lists.
- `viewChild()` / `viewChildren()` / `contentChild()` /
  `contentChildren()` (plus `.required`) — `R3QueryMetadata`
  with `isSignal: true`.

Inline `host: { ... }` decorator-arg entries are parsed by key
shape (`'[prop]'` → property binding, `'(event)'` → listener,
plain key → attribute). Plain attribute values are wrapped as
`WrappedNodeExpr`.

---

## 8. Dev pipeline

The Angular HMR fast path is one component of a broader dev
pipeline. Two non-Angular pieces of the pipeline are necessary
preconditions and are documented here for completeness.

### 8.1 Single Angular core instance per SSR runtime

When two distinct `@angular/core` module instances load in the
same SSR process — typically because the SSR bundle resolves
through a vendored copy while platform code resolves through
the real package — each gets its own `currentInjector` global.
`inject()` calls cross the boundary and read the wrong one. The
runtime symptom is `NG0203: The <Token> token injection failed`
on a token that demonstrably exists.

The fix pins the SSR pipeline to a single resolution path for
every `@angular/*` package — either bundled vendor (production)
or Bun's runtime resolution of the bare specifier (development).
A build-time check (`src/build/verifyAngularCoreUniqueness.ts`)
walks every server bundle's import statements and fails the
build if more than one distinct `@angular/core` resolution
shape is present.

This is unrelated to HMR latency, but Bun's `--hot` invalidates
and re-evaluates modules on every edit, so any HMR system on
top of Bun must keep this invariant or face intermittent NG0203
failures.

### 8.2 No bundling on the hot path

`compileAngular` runs once at startup (and on Tier 1b
rebootstrap) to JIT-transpile every page's recursive Angular
import graph into `.absolutejs/generated/angular/`. The dev
moduleServer (`src/dev/moduleServer.ts`) serves those files
at `/@src/...` with per-request transforms. Edits invalidate
and re-emit the affected file only.

Two virtual-module concerns Bun's transpiler raises:

- `bun:wrap` — Bun emits `import { __legacyDecorateClassTS,
  __legacyMetadataTS } from "bun:wrap"` for every legacy-decorator
  class, including every Angular component. moduleServer serves
  this as a virtual ESM exporting the standard TypeScript
  runtime helpers.
- `node:*` builtins — code paths that import `node:fs` /
  `node:path` etc. are routed to `/@stub/<name>` (a noop module).
  Server-only code that transitively reaches a browser bundle
  loads without 404-ing the import graph; the calls become
  no-ops.

---

## 9. Tradeoffs

### 9.1 Template type-checking is delegated

The HMR pipeline does not run the template type-check block.
Type errors in templates surface in the editor's TypeScript
Language Server (and in the next production build), not at HMR
save. Projects without an editor TS server lose this feedback
on the hot path.

This is the principal architectural choice and the source of
the ~13 ms server-side dispatch number.

### 9.2 Default compilation flags only

The HMR pipeline uses Angular's default IR compilation flags.
Custom compiler flags (`strictTemplates`, custom JIT
evaluators, etc.) are not honored on the fast path. Production
builds run the full ngtsc pipeline and honor the project's
tsconfig.

### 9.3 Coverage tracks Angular's IR

When Angular adds a new field to `R3ComponentMetadata`, the
extractor needs an update to populate it. The current
implementation covers Angular 17–21. Future minors may require
additive changes (typically ~30 lines per new field).

### 9.4 Vendored render3 internals are version-locked

Tier 1a per-component remount uses non-public LView slot
operations from `@angular/core/src/render3` (`destroyLView`,
`replaceLViewInTree`, `cleanupLView`, etc.). A minimal slice
of these is vendored into `src/dev/client/vendor/lview/`.
Locked to a specific Angular minor; refresh on each Angular
upgrade alongside the translator vendor.

---

## 10. Notes on specific edit shapes

### 10.1 TS method body edits

The fast extractor returns `fingerprintChanged: false` since
neither the structural surface nor any per-instance arrow-field
hash changes. Tier 0 dispatch.

### 10.2 Template edits (inline and external)

Inline template literals are read directly from the
`@Component` decorator's `template` property. External
`templateUrl` files are resolved against the component
directory and read from disk. In both cases the new template
is fed to `parseTemplate` and the resulting nodes flow into
`R3ComponentMetadata.template`. Tier 0 dispatch.

A resource index (`src/dev/angular/resolveOwningComponents.ts`)
maps `templateUrl` and `styleUrl` paths to the components that
reference them, so a `.html` edit dispatches to the owning
component without rescanning the project.

### 10.3 Adding an `@Input` (structural change)

The fingerprint's input-binding-name list changes, so
`tryFastHmr` returns `fingerprintChanged: true` and the
dispatcher broadcasts `angular:component-remount`. The browser
destroys and recreates the affected component instance(s) using
public `createComponent` plus the vendored LView slot
operations. The new constructor runs against the new field
list with fresh DI.

Server-side compilation cost is identical to Tier 0; the
remount work happens entirely in the browser.

### 10.4 External `.css` edits

External `.css` files reachable via the `styleUrl` /
`styleUrls` of a component currently dispatch through the
framework-wide CSS HMR (stylesheet swap, manifest rebuild) and
not through Angular's metadata-replacement path. The visible
result is the same — the new styles apply to the running page —
but the work flows through a different code path with
different cost characteristics.

This routing is shared with React, Svelte, and Vue components,
which lack an Angular-equivalent metadata-replacement primitive
for styles. A future optimization could route component-bound
CSS edits through the Angular fast path when a single
unambiguous owning component exists, dropping the cost into
the Tier 0 band.

---

## 11. Reproducing the benchmarks

The benchmark harness lives at `benchmarks/angular-hmr/` in the
AbsoluteJS repository.

```bash
cd benchmarks/angular-hmr
bun install
bun run dev          # starts dev server on :4321, tees to dev.log
# in a second shell:
bun run bench        # connects to ws://localhost:4321/hmr
```

The bench script alternates apply/revert text replacements on
each fixture file, waits for the matching HMR broadcast on the
WebSocket, and parses the dev server's own log line for the
server-side dispatch breakdown. Originals are restored on exit
and on SIGINT.

Configuration via environment variables:

- `HMR_BENCH_N` — sample count per case (default: 30)
- `HMR_BENCH_WARMUP` — warmup iterations (default: 3)
- `HMR_BENCH_TIMEOUT_MS` — per-iteration timeout (default: 15000)
- `HMR_BENCH_WS_URL` — dev server WS URL
- `HMR_BENCH_DEV_LOG` — dev log path

The fixture has three components and one page. Numbers will
shift with project size (more imports = larger AST walk; more
declarations to resolve for `imports: [...]`); the band the
reference numbers occupy should reproduce on comparable hardware.

---

## 12. Source map

Files referenced in this document, all under
`src/` of `@absolutejs/absolute`:

- `dev/angular/fastHmrCompiler.ts` — single-file metadata
  extraction + `compileComponentFromMetadata` call +
  module emit.
- `dev/angular/resolveOwningComponents.ts` — inverted index
  `templateUrl` / `styleUrls` → owning component class.
- `dev/angular/hmrInjectionPlugin.ts` — emits per-class
  `__ng_hmr_load` / `__ng_hmr_remount` listeners and the
  `__abs_deps` registry into every Angular component file.
- `dev/angular/hmrCompiler.ts` — `/@ng/component?c=<id>&t=<ts>`
  endpoint dispatcher.
- `dev/angular/hmrImportGenerator.ts` — `ImportGenerator`
  implementation for the vendored translator.
- `dev/angular/vendor/translator/` — vendored Angular
  `translateStatement` from `@angular/compiler-cli`.
- `dev/client/handlers/angularHmrShim.ts` — runtime shim
  registering the WebSocket message bus on
  `globalThis.__angularHmr`.
- `dev/client/handlers/angularRemount.ts` — Tier 1a
  per-component remount client implementation.
- `dev/client/vendor/lview/` — vendored LView slot constants
  and operations from `@angular/core`'s render3 internals.
- `dev/rebuildTrigger.ts` — `decideAngularTier` and the
  Tier 0 / 1a / 1b / user-error broadcast helpers.
- `dev/moduleServer.ts` — on-demand TS transformer; serves
  the `bun:wrap` virtual module and stubs `node:*` builtins.
- `dev/client/hmrClient.ts` — WebSocket message router.
- `build/compileAngular.ts` — JIT page transpile and
  `__ABS_ANGULAR_REBOOTSTRAP__` hook generation.
- `build/verifyAngularCoreUniqueness.ts` — build-time check
  that the SSR runtime resolves a single `@angular/core`
  instance.

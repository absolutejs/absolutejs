# AbsoluteJS Angular HMR

A reference description of how AbsoluteJS implements hot module
replacement for Angular components, the techniques that produce
sub-50 ms end-to-end edit latency, and the architectural
difference from `@angular/build`-driven HMR.

Available in `@absolutejs/absolute@0.19.0-beta.918` and later.

* Repository: <https://github.com/absolutejs/absolutejs>
* Documentation: <https://absolutejs.com>

---

## 1. Overview

Angular ships an HMR runtime primitive, `ɵɵreplaceMetadata`,
which atomically substitutes a component's compiled definition
on the live class while the application keeps running. Every
Angular HMR implementation (`@angular/build`, the official
esbuild builder; `@analogjs/vite-plugin-angular`; AbsoluteJS)
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

Type-checking is delegated to other tools (§9.1): the editor's
TypeScript Language Server during authoring, and AbsoluteJS's
own `absolute typecheck` CLI command (which invokes `ngc` with
`strictTemplates: true`) in CI. The HMR pipeline does not
duplicate that work on every keystroke.

---

## 2. Benchmark results

Project: 3 standalone Angular components (root page,
inline-template `HeaderComponent`, `templateUrl` + `styleUrl`
`CounterComponent`).

Stack: `@absolutejs/absolute@0.19.0-beta.918`, `@angular/* 21.2.11`,
Bun 1.3.13, Linux/WSL2.

Methodology: a Bun client connects to the dev server's `/hmr`
WebSocket, performs scripted text replacements on each fixture
file (apply / revert alternating), and records two values per
iteration:

* **Server-side dispatch**: parsed from the dev server's own
  `[ng-hmr]` (or `[hmr] css update`) log line.
* **End-to-end**: time from `fs.writeFile` resolving until the
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
localhost roundtrip; that pipeline overhead exists for any HMR
system at any speed.

The bench harness is committed at `benchmarks/angular-hmr/`. See
§11 for instructions.

---

## 3. The Angular HMR runtime primitive

`ɵɵreplaceMetadata` is exported from `@angular/core`'s render3
internals (typed `@private` but stable across recent minors).
Its callers fetch a per-class update payload (typically as an
ES module) and invoke it.

```ts
ɵɵreplaceMetadata(type, applyMetadata, namespaces, locals, importMeta, id);
```

Internally it:

1. Calls `applyMetadata(type, namespaces, ...locals)`. This is
   the recompilation step: the payload module typically calls
   `compileComponentFromMetadata` on a fresh `R3ComponentMetadata`
   describing the new state of the component.
2. Reads the resulting `ɵcmp` definition off the class.
3. Calls `mergeWithExistingDefinition(currentDef, newDef)`,
   which copies most fields from `newDef` onto `currentDef`
   *but explicitly preserves* `directiveDefs`, `pipeDefs`,
   `setInput`, and `type`.
4. Walks all live `LView`s of the affected component and
   recreates each one against the new `tView`.

The merge step in (3) is load-bearing for the AbsoluteJS
implementation. It means the HMR payload doesn't need to
reproduce the original component's directive/pipe scope.
Whatever scope was established at the initial bundle's
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
3. **Extract** `R3ComponentMetadata` via AST walks (see §7 for
   the covered surface).
4. **Compile** by calling `compileComponentFromMetadata` against
   `@angular/compiler`'s built-in `ConstantPool` and binding
   parser.
5. **Translate** the resulting statement list to module text via
   a vendored copy of Angular's `translateStatement`.
6. **Emit** the module with a leading `__abs_deps` destructure
   (see §7.3) and a default-exported function matching the
   `applyMetadata` signature `ɵɵreplaceMetadata` expects.

If any step fails (file not parseable, class not found, no
recognized decorator, parent class with its own decorator), the
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

* Constructor parameter type list
* Selector and `standalone` flag
* Input / output binding-name lists (alias-aware)
* Presence of `providers` / `viewProviders` on the decorator
* Provider import signature (sorted markers for `imports: [...]`
  entries whose source is an `@NgModule` carrying `providers`)
* Member decorator signatures (excluding `@Input`/`@Output`,
  which are captured via the binding-name lists)
* Per-instance arrow-function field initializer hashes (since
  prototype patching cannot propagate arrow-field bodies to
  existing instances)
* Top-level import bindings of the source file (named, default,
  namespace; type-only excluded). Adding or removing a
  top-level import escalates to Tier 1a remount so the class's
  `__abs_deps` registry (§7.3) is rebuilt to match current
  source, which is necessary for the HMR payload to resolve
  identifiers correctly.

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

`__abs_deps` is an AbsoluteJS-specific convention: a custom
static property added to every Angular-decorated class at
compile time, containing every top-level binding from the
source file's import list.

```ts
// hmrInjectionPlugin appends, alongside the user's exports:
ComponentName.__abs_deps = { TriggerFn, MyService, CommonModule, ... };
```

It is not a standard cross-framework HMR pattern. It is also
not a runtime hack in the sense of monkey-patching Angular: the
property is a normal JavaScript class property that lives
alongside Angular's own static metadata properties (`ɵfac`,
`ɵcmp`, `ɵdir`, `ɵpipe`), follows the same shape, and carries
no special meaning to Angular. AbsoluteJS owns the prefix and
the contents.

The reason it exists: identifiers in the HMR payload (per §7.2
they are `WrappedNodeExpr` nodes referring to symbols from the
user's source) need to resolve to the same JavaScript values
the live class was bootstrapped against. Two alternatives were
considered:

* **Re-import on every HMR cycle.** The HMR payload would
  declare its own `import { TriggerFn } from '...'` statements.
  This works, but adds a per-edit module fetch per dependency
  and makes the payload module's identity depend on the
  module-graph version. With dozens of imports per typical
  component, the cost is non-trivial and the per-broadcast
  fetch latency dominates a 13 ms server-side dispatch.
* **A registry on the class.** The bundle-time plugin captures
  the imports once and stashes them where the live class can
  find them. The HMR payload destructures from there. No
  additional fetches; identity is stable across cycles.

The second alternative is what `__abs_deps` implements.

Any edit that adds or removes a top-level import in the
component file shifts the structural fingerprint (§6) and
escalates to Tier 1a remount, regardless of where the new
binding is referenced. Tier 1a fetches a freshly evaluated
module whose `__abs_deps` reflects current source, so the live
class's deps are always in sync with what the HMR payload
expects. The cost on edits that don't touch imports (the common
case: method bodies, templates, styles) is unchanged, since
those leave the fingerprint untouched and stay on Tier 0.

### 7.4 Directive scope preservation via `mergeWithExistingDefinition`

Per §3, `ɵɵreplaceMetadata` preserves the original definition's
`directiveDefs` and `pipeDefs` from the initial bundle. Those
were populated by Angular's standard scope analysis at
bootstrap: for standalone components from their `imports: [...]`
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
works correctly (e.g. `<my-comp src="literal">` renders as an
input binding rather than a DOM attribute).

For each entry in the user's `imports: [...]` array, the
pipeline resolves it to:

* A project-local `.ts` source: parse the source file, locate
  the class, read decorator metadata directly.
* A library `.d.ts` shipped declaration: walk the package's
  re-export barrels, locate the exported `ɵcmp` / `ɵdir` /
  `ɵpipe` static, read selector / inputs / outputs from there.

For non-standalone components the dependency list stays empty.
`isStandalone: false` forces `Full` mode regardless, and the
preserved `directiveDefs` from the initial bundle covers
template resolution.

### 7.6 Decorator-aware inheritance handling

Angular merges metadata up the heritage chain only when the
parent class itself carries `@Component`, `@Directive`, `@Pipe`,
or `@Injectable`. Plain `class Foo extends BaseUtility` (no
parent decorator) requires no metadata merging. The prototype
chain handles method inheritance and the child's own
`R3ComponentMetadata` is sufficient.

The HMR pipeline resolves the parent class identifier through
the source file's import list:

* Same-file parent: scan the AST.
* Cross-file project-local parent: walk the import declaration,
  resolve to a `.ts` source, parse, locate the class.
* Bare-specifier (node_modules) parent: bail conservatively
  (could be decorated; library metadata-merging not implemented).

Only when the resolved parent has an Angular decorator does the
pipeline fall back to Tier 1b. Most `extends` cases stay on
Tier 0.

### 7.7 Decorator and signal-form coverage

The AST walks cover both decorator and signal-based forms for
inputs, outputs, queries, and host bindings:

* `@Input` / `@Output` (decorator form, alias-aware via
  `@Input({ alias: 'foo' })`).
* `input(default, { alias })`, `input.required(...)`,
  `output(...)`, `model(...)` (signal form, detected by
  initializer call to a known `@angular/core` symbol).
* `@HostBinding('class.foo') prop` and
  `@HostListener('click', [...]) onClick(e)` merge into
  `R3HostMetadata.properties` / `listeners`.
* `@ViewChild` / `@ViewChildren` / `@ContentChild` /
  `@ContentChildren` map to `R3QueryMetadata` with
  `static`/`descendants`/`read`/`emitDistinctChangesOnly`
  preserved. Token args wrapped as `WrappedNodeExpr`; string
  args become predicate string lists.
* `viewChild()` / `viewChildren()` / `contentChild()` /
  `contentChildren()` (plus `.required`) map to
  `R3QueryMetadata` with `isSignal: true`.

Inline `host: { ... }` decorator-arg entries are parsed by key
shape (`'[prop]'` for property binding, `'(event)'` for
listener, plain key for attribute). Plain attribute values are
wrapped as `WrappedNodeExpr`.

---

## 8. Dev pipeline

The Angular HMR fast path is one component of a broader dev
pipeline. Two non-Angular pieces of the pipeline are necessary
preconditions and are documented here for completeness.

### 8.1 Single Angular core instance per SSR runtime

When two distinct `@angular/core` module instances load in the
same SSR process (typically because the SSR bundle resolves
through a vendored copy while platform code resolves through
the real package), each gets its own `currentInjector` global.
`inject()` calls cross the boundary and read the wrong one. The
runtime symptom is `NG0203: The <Token> token injection failed`
on a token that demonstrably exists.

The fix pins the SSR pipeline to a single resolution path for
every `@angular/*` package: bundled vendor in production, or
Bun's runtime resolution of the bare specifier in development.
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

* `bun:wrap`. Bun emits
  `import { __legacyDecorateClassTS, __legacyMetadataTS } from "bun:wrap"`
  for every legacy-decorator class, including every Angular
  component. moduleServer serves this as a virtual ESM
  exporting the standard TypeScript runtime helpers.
* `node:*` builtins. Code paths that import `node:fs` /
  `node:path` etc. are routed to `/@stub/<name>` (a noop
  module). Server-only code that transitively reaches a
  browser bundle loads without 404-ing the import graph; the
  calls become no-ops.

---

## 9. Tradeoffs

### 9.1 Template type-checking is delegated, not skipped

The HMR pipeline does not run the template type-check block
(TCB) on edit. Type-checking is delegated to other tools that
already do it well:

* The TypeScript Language Server in the editor surfaces
  template errors during authoring (when `@angular/language-service`
  is enabled, as it is by default in VS Code's Angular extension
  and in the JetBrains Angular plugin).
* `absolute typecheck` (`src/cli/scripts/typecheck.ts`) invokes
  `ngc` from `@angular/compiler-cli` with `strictTemplates: true`
  on the project's Angular sources. It produces command-line
  output suitable for CI gates and pre-commit hooks.

A typical project with a CI pipeline running `absolute typecheck`
on every push, plus an editor TS server during authoring, sees
template errors at the same moments it would in an `ng build`
flow. The HMR pipeline simply does not duplicate that work on
each keystroke.

This delegation is the principal architectural choice and the
source of the ~13 ms server-side dispatch number.

### 9.2 `angularCompilerOptions` coverage matrix

The fast path reads the project's `tsconfig.json` once at dev
startup and propagates the subset of `angularCompilerOptions`
that meaningfully affects IR codegen output. Production builds
run through `absolute build` and the full ngtsc pipeline, which
honors every option without caveats.

This table covers every public option in
`@angular/compiler-cli`'s `LegacyNgcOptions`,
`TypeCheckingOptions`, `DiagnosticOptions`, `BazelAndG3Options`,
`I18nOptions`, `TargetOptions`, and `MiscOptions` interfaces.

| Option                                     | Status            | Notes |
|--------------------------------------------|-------------------|-------|
| `preserveWhitespaces`                      | Propagated        | Project-level default applied when an individual `@Component` decorator doesn't specify; decorator value wins when both are present. |
| `enableI18nLegacyMessageIdFormat`          | Propagated        | Passed to `parseTemplate`. Required for projects on the legacy `$localize` ID format to avoid translation misses on HMR'd templates. |
| `i18nUseExternalIds`                       | Propagated        | Written into `R3ComponentMetadata`. Closure-style external i18n IDs in message variable names must match production for translation lookups. |
| `i18nNormalizeLineEndingsInICUs`           | Propagated        | Passed to `parseTemplate`. ICU expression line-ending normalization affects message hashes used for translation IDs. |
| `compilationMode`                          | Divergence by design | The HMR runtime contract requires runnable IR for `ɵɵreplaceMetadata` to apply. `'partial'` produces declarations intended for the linker step at consumer build time and isn't directly executable. The fast path always uses `'full'` (what `compileComponentFromMetadata` emits) regardless of project setting. Production builds honor `compilationMode` independently for their own emit. |
| `strictTemplates`                          | TCB-only          | Enforced by `@angular/language-service` (editor) and `absolute typecheck` (CLI/CI). The fast path doesn't synthesize a TCB. |
| `strictInputTypes`                         | TCB-only          | Same as above. |
| `strictInputAccessModifiers`               | TCB-only          | Same as above. |
| `strictNullInputTypes`                     | TCB-only          | Same as above. |
| `strictAttributeTypes`                     | TCB-only          | Same as above. |
| `strictSafeNavigationTypes`                | TCB-only          | Same as above. |
| `strictDomLocalRefTypes`                   | TCB-only          | Same as above. |
| `strictOutputEventTypes`                   | TCB-only          | Same as above. |
| `strictDomEventTypes`                      | TCB-only          | Same as above. |
| `strictContextGenerics`                    | TCB-only          | Same as above. |
| `strictLiteralTypes`                       | TCB-only          | Same as above. |
| `strictInjectionParameters`                | TCB-only          | Same as above. |
| `strictStandalone`                         | TCB-only          | Standalone-prohibition diagnostic; enforced at type-check time. |
| `typeCheckHostBindings`                    | TCB-only          | Same as above. |
| `extendedDiagnostics`                      | TCB-only          | Diagnostic categorization for TCB-emitted issues. |
| `fullTemplateTypeCheck`                    | TCB-only          | Deprecated alias of the strict\* family; same delegation. |
| `compileNonExportedClasses`                | N/A               | The fast path operates on classes resolved from the live registry by name, which are always exported. |
| `disableTypeScriptVersionCheck`            | N/A               | TS version check runs at build configuration time, not in the HMR pipeline. |
| `forbidOrphanComponents`                   | N/A               | Runtime guard installed at app bootstrap (not per-component). HMR payloads do not re-bootstrap, so the existing guard remains active without re-installation. |
| `flatModuleOutFile`                        | N/A               | Library publishing format; not relevant to dev HMR. |
| `flatModuleId`                             | N/A               | Same as above. |
| `allowEmptyCodegenFiles`                   | N/A               | Deprecated; controls codegen file emit. |
| `i18nInLocale`                             | N/A               | xi18n extraction tool config; not consumed during compile. |
| `i18nOutLocale`                            | N/A               | Same as above. |
| `i18nOutFormat`                            | N/A               | Same as above. |
| `i18nOutFile`                              | N/A               | Same as above. |
| `i18nPreserveWhitespaceForLegacyExtraction`| N/A               | View Engine extraction pipeline only. |
| `generateDeepReexports`                    | N/A               | Bazel/G3 path-mapped library builds. |
| `onlyPublishPublicTypingsForNgModules`     | N/A               | Library `.d.ts` emit. |
| `annotateForClosureCompiler`               | N/A               | Closure-compiler JSDoc annotations in output; not part of the HMR payload format. |
| `generateExtraImportsInLocalMode`          | N/A               | G3-internal bundling concern. |
| `_experimentalAllowEmitDeclarationOnly`    | N/A               | Declaration-only emit mode for g3 experiments. |
| `onlyExplicitDeferDependencyImports`       | Pending           | Affects how `@defer` blocks resolve dependencies. The fast path's current `@defer` handling uses `R3ComponentMetadata.defer.mode = 0` (PerComponent, no per-block deps). Propagating this would land alongside per-block dep extraction; HMR for `@defer` blocks with explicit deps falls back to Tier 1b until then. |
| `_enableTemplateTypeChecker` (test-only)   | N/A               | Compiler-internal test option. |
| `_compilePoisonedComponents` (test-only)   | N/A               | Compiler-internal test option. |
| `tracePerformance` (test-only)             | N/A               | ngtsc-internal performance trace; format is unstable. |
| `_checkTwoWayBoundEvents` (internal)       | N/A               | Compiler-internal. |
| `_isAngularCoreCompilation` (internal)     | N/A               | Used only when compiling `@angular/core` itself. |

### 9.3 Coverage tracks Angular's IR

When Angular adds a new field to `R3ComponentMetadata`, the
extractor needs an update to populate it. The current
implementation covers Angular 17 through 21. Future minors may
require additive changes (typically ~30 lines per new field).

### 9.4 Vendored render3 internals are version-locked

Tier 1a per-component remount uses LView slot operations from
`@angular/core/src/render3` (`destroyLView`,
`replaceLViewInTree`, `cleanupLView`, etc.) that are not part
of Angular's public API surface. A minimal slice of the
required source is vendored verbatim into
`src/dev/client/vendor/lview/`. The vendor is a copy, not a
fork: nothing in the vendored files is modified, and a refresh
on each Angular minor is straightforward.

If the Angular team chose to expose these operations as a
public API (or a documented `@private`-but-stable surface like
`ɵɵreplaceMetadata` itself), the vendor could be retired in
favor of a direct import. The shape needed is small (a handful
of functions plus the LView/LContainer slot constants), and the
use case (per-component remount during HMR for state-shape
changes) is general-purpose enough that this is plausibly a
useful public surface for any HMR implementation, not only
AbsoluteJS. Tracking that as a future possibility rather than a
permanent constraint is the more accurate framing.

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
result is the same (the new styles apply to the running page),
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

* `HMR_BENCH_N`: sample count per case (default: 30)
* `HMR_BENCH_WARMUP`: warmup iterations (default: 3)
* `HMR_BENCH_TIMEOUT_MS`: per-iteration timeout (default: 15000)
* `HMR_BENCH_WS_URL`: dev server WS URL
* `HMR_BENCH_DEV_LOG`: dev log path

The fixture has three components and one page. Numbers will
shift with project size (more imports means a larger AST walk;
more declarations to resolve for `imports: [...]`); the band
the reference numbers occupy should reproduce on comparable
hardware.

---

## 12. Source map

Files referenced in this document, all under
`src/` of `@absolutejs/absolute`:

* `dev/angular/fastHmrCompiler.ts`: single-file metadata
  extraction, `compileComponentFromMetadata` call, module
  emit.
* `dev/angular/resolveOwningComponents.ts`: inverted index
  mapping `templateUrl` and `styleUrls` to owning component
  classes.
* `dev/angular/hmrInjectionPlugin.ts`: emits per-class
  `__ng_hmr_load` and `__ng_hmr_remount` listeners and the
  `__abs_deps` registry into every Angular component file.
* `dev/angular/hmrCompiler.ts`: `/@ng/component?c=<id>&t=<ts>`
  endpoint dispatcher.
* `dev/angular/hmrImportGenerator.ts`: `ImportGenerator`
  implementation for the vendored translator.
* `dev/angular/vendor/translator/`: vendored Angular
  `translateStatement` from `@angular/compiler-cli`.
* `dev/client/handlers/angularHmrShim.ts`: runtime shim
  registering the WebSocket message bus on
  `globalThis.__angularHmr`.
* `dev/client/handlers/angularRemount.ts`: Tier 1a
  per-component remount client implementation.
* `dev/client/vendor/lview/`: vendored LView slot constants
  and operations from `@angular/core`'s render3 internals.
* `dev/rebuildTrigger.ts`: `decideAngularTier` and the
  Tier 0 / 1a / 1b / user-error broadcast helpers.
* `dev/moduleServer.ts`: on-demand TS transformer; serves
  the `bun:wrap` virtual module and stubs `node:*` builtins.
* `dev/client/hmrClient.ts`: WebSocket message router.
* `build/compileAngular.ts`: JIT page transpile and
  `__ABS_ANGULAR_REBOOTSTRAP__` hook generation.
* `build/verifyAngularCoreUniqueness.ts`: build-time check
  that the SSR runtime resolves a single `@angular/core`
  instance.
* `cli/scripts/typecheck.ts`: `absolute typecheck` invocation
  of `ngc` with `strictTemplates: true`.

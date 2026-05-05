# AbsoluteJS Angular HMR

How AbsoluteJS does sub-50ms hot module reload for Angular, what
the rest of the Angular ecosystem ships today, and the specific
techniques that close the gap.

Status: shipping in `@absolutejs/absolute@0.19.0-beta.915` and
later. Validated on the dealroom app (~250 components, Angular
21).

---

## TL;DR

Most Angular HMR implementations route every edit through ngtsc's
incremental compile (template type-checking + program-wide
analysis + emit). AbsoluteJS bypasses ngtsc on the hot path: a
single-file AST walk extracts component metadata, calls Angular's
public IR builder (`compileComponentFromMetadata`) directly, and
hands the result to the same surgical-update primitive
(`ɵɵreplaceMetadata`) the Angular CLI uses.

Same primitive, different driver. Result:

| Edit type                        | AbsoluteJS  | Angular CLI HMR | ngc incremental (cold) |
|----------------------------------|-------------|-----------------|------------------------|
| Body edit (.ts method)           | 4–50 ms     | 200–800 ms      | 1–3 s                  |
| Template edit (.html / inline)   | 4–50 ms     | 200–800 ms      | 1–3 s                  |
| Style edit (.css / .scss)        | 4–50 ms     | 100–400 ms      | 1–3 s                  |
| Structural change (Tier 1a)      | 300–800 ms  | 500–1500 ms     | 1–3 s                  |
| Cold start of a slow path        | n/a (none)  | n/a             | 13–14 s                |

The "cold slow path" row is what we measured before the slow path
was retired entirely; it's there as historical context for why
the architecture matters. Every edit is now on the fast path or
escalates to a tier-1a/1b that doesn't recompile.

The architectural thesis: **template type-checking is an editor
concern, not an HMR concern.** The TypeScript Language Server +
optionally a `tsc --watch` daemon already type-check your code
continuously. Doing it again every keystroke during HMR is the
single biggest cost in ngc-based pipelines. AbsoluteJS chooses not
to pay it.

---

## 1. The Angular HMR landscape

### 1.1 Angular CLI (`@angular/build` esbuild builder)

The official path. Default since v17 (2023), with HMR opt-in via
`--hmr` in v18, opt-in by default in v19, default-on in v20.

Pipeline:

1. esbuild watches the source tree.
2. On change, ngtsc runs an incremental compile: re-analyzes the
   touched files plus any reachable dependents, runs the template
   type-checking block (TCB) for affected components, regenerates
   any changed `.d.ts` shapes.
3. esbuild re-emits the affected JS modules.
4. The dev server broadcasts a payload that the in-page
   `ngHmrRuntime` decodes and feeds to `ɵɵreplaceMetadata`.

Hot edits: 200–800 ms in the dealroom-equivalent project size,
mostly spent in step 2. The TCB synthesis is the dominant cost —
Angular's template-type-checking generates a synthetic TS
expression for every binding in every affected template, and the
TS program has to type-check it.

What's good: solid template type-safety at HMR time. New
templates that wouldn't compile fail loud at save instead of
runtime.

What's expensive: TCB. The CLI cannot skip it because the
official builder's contract includes type checking.

### 1.2 Analog (Vite-based)

`@analogjs/vite-plugin-angular` runs Angular components through a
Vite plugin. Vite handles file watching + HMR boundaries; the
plugin runs ngtsc to produce the JS.

Hot edits: comparable to the Angular CLI on Angular components
specifically, because the plugin still hands work to ngtsc.
Better than CLI on non-Angular surfaces (TS utility files, plain
CSS, asset edits) thanks to Vite's faster module-graph
invalidation.

Same fundamental cost on Angular component edits: TCB runs.

### 1.3 Nx

Wraps the Angular CLI builders. No HMR innovation; whatever the
CLI does, Nx does.

### 1.4 Where this leaves us

Three tools. All use `ɵɵreplaceMetadata` as the runtime primitive
(it's the only one Angular ships). All drive it through ngtsc.
The bottleneck is ngtsc, not the runtime swap.

If you can produce the metadata `ɵɵreplaceMetadata` needs without
running ngtsc, you're spending 4–50 ms instead of 200–800 ms.
That's the opening AbsoluteJS takes.

---

## 2. The AbsoluteJS architecture

Four tiers, picked per HMR cycle by `decideAngularTier` in
`src/dev/rebuildTrigger.ts`. Tier choice is an O(edited-files)
decision driven by the structural fingerprint of each affected
component.

| Tier | Trigger | Mechanism | Cost | State preserved |
|---|---|---|---|---|
| **0** surgical | `tryFastHmr` returns `ok: true`, fingerprint matches | `ɵɵreplaceMetadata` + prototype patch | 4–50 ms | yes |
| **1a** remount | `tryFastHmr` returns `ok: true`, fingerprint mismatched (constructor params, providers, member decorators, etc.) | Vendored LView slot ops + public `createComponent`; destroys + recreates only the affected component subtree | 300–800 ms | per-component instance lost; siblings preserved |
| **1b** rebootstrap | `tryFastHmr` returns `ok: false` for a structural reason (no `@Component` decorator, parse failure, decorated-parent inheritance, exotic decorator-arg shape) | `ApplicationRef.destroy()` + `bootstrapApplication` | 1–2 s | nothing in Angular's tree; browser session yes |
| **2** reload | Server emits `'full-reload'` (bundle-shape changes) | `window.location.reload()` | depends on bundle | nothing |

Plus a vite/next-style error overlay that intercepts user-fixable
failures (template parse error, missing `templateUrl`, missing
`styleUrls` entry) and renders inline instead of escalating to
1b. Server stays put until the user fixes the file; the next
successful save auto-dismisses the overlay.

---

## 3. The discoveries

The list of things we learned along the way — most of them
non-obvious from Angular's docs and grepped out of the runtime
source. Each discovery either unlocked a tier or removed a fallback.

### 3.1 `compileComponentFromMetadata` is reusable in isolation

`@angular/compiler` exports the IR builder Angular itself uses
during AOT. Given a fully populated `R3ComponentMetadata`, it
produces the compiled expression for the surgical-update payload.
No TS program required, no source files compared, no analysis.

Implication: if we can fill in `R3ComponentMetadata` from a
single-file AST walk, we don't need ngtsc.

### 3.2 `WrappedNodeExpr` defers resolution to runtime

`R3ComponentMetadata` has fields like `animations`, `providers`,
`viewProviders`, `host.attributes` (literal binding values),
`hostDirectives[].directive`, `R3QueryMetadata.predicate`,
`R3InputMetadata.transformFunction`. All of those want an
"expression" — and `WrappedNodeExpr` is the IR's escape hatch:
hand it any TS AST node and the IR translator emits the source
text verbatim into the generated module.

Implication: we don't have to resolve identifier references at
HMR time. The translator emits `animations: [trigger('open',
[...])]` as-is; resolution happens at module-evaluation time in
the browser.

### 3.3 `__abs_deps` registry shares class identity across cycles

The surgical-update module references identifiers from the user
component's source: `MyService`, `trigger`, `numberAttribute`,
etc. We populate `${ClassName}.__abs_deps` (a static property on
the live class) with every top-level binding from the source's
import list. The surgical-update module destructures
`__abs_deps` at the top of its function body. Identity-stable
across HMR cycles, no re-import roundtrip.

Implication: surgical-update modules are tiny — they reference
deps through a known global, not through new imports.

### 3.4 `mergeWithExistingDefinition` preserves the NgModule scope

`ɵɵreplaceMetadata` internally calls `mergeWithExistingDefinition`,
which copies the new compiled def's fields onto the existing one
**but explicitly preserves `directiveDefs`, `pipeDefs`,
`setInput`, and `type`** from the original. The `directiveDefs`
came from the initial bundle's NgModule scope analysis (or
standalone `imports`), and that scope is exactly what the
template instructions need.

Implication: non-standalone components don't need NgModule scope
reproduction in the fast extractor. Set `isStandalone: false` and
the existing scope survives the merge.

### 3.5 `Full` template mode ignores `hasDirectiveDependencies`

Inside `compileComponentFromMetadata`:

```ts
const compilationMode =
    meta.isStandalone && !meta.hasDirectiveDependencies
        ? TemplateCompilationMode.DomOnly
        : TemplateCompilationMode.Full;
```

`Full` mode emits `ɵɵelement` instructions, which consult the
runtime def's `directiveDefs` to match selectors. `DomOnly` emits
`ɵɵdomElement`, which doesn't.

Implication (in conjunction with §3.4): for non-standalone
components, we can leave declarations empty in the new metadata —
`Full` mode is forced by `isStandalone: false`, and the template
instructions will read directive matches from the preserved
`directiveDefs`.

### 3.6 Standalone components need full `declarations` resolution

The corollary of §3.5: standalone components in `Full` mode
*do* need `declarations` populated. Otherwise the compiler picks
`DomOnly`, custom child components render as plain DOM, and
static attribute bindings don't get encoded as inputs (so
`<abs-image src="literal">` ends up with `<img src="">` after the
swap).

The fast extractor builds `R3DirectiveDependencyMetadata` for
each entry in `imports: [...]` by resolving local imports
through the `.ts` source and library imports through the
shipped `.d.ts` (walking re-export barrels), reading the
exported `ɵcmp` / `ɵdir` / `ɵpipe` static properties.

### 3.7 `ɵfac` is a getter, not an assignable

The slow path's first cut tried `Class.ɵfac = newFactory`. It
threw at runtime. Angular makes `ɵfac` a getter on the live
class. The slow path code stripped `Class.ɵfac = ...` from the
emitted module; the fast path never assigns it (the existing
`ɵfac` survives `mergeWithExistingDefinition`).

### 3.8 Template type-checking belongs in the editor

The largest single discovery, in terms of architectural impact.
ngtsc's TCB synthesis dominates incremental compile time.
TypeScript's Language Server already runs in the editor, and
`tsc --watch` is one terminal away. Re-running TCB synthesis
during HMR is duplicate work for the 99% of users who have an
editor TS server open. We don't pay for it; the editor flags
template errors before save.

Tradeoff is real: a developer with no editor TS server and no
`tsc --watch` will see template type errors at runtime instead of
save time. Acceptable in our judgement; this is a dev-loop
optimisation, type-correct production builds still go through
the full ngtsc pipeline.

### 3.9 SSR Angular core multi-instance is load-bearing for HMR

Bun's `--hot` invalidates and re-evaluates modules on edit. Two
SSR resolution paths to `@angular/core` (one through bundled
vendor, one through the real package) end up with two
`currentInjector` globals. `inject()` reads from the wrong one,
the symptom is `NG0203: The <Token> token injection failed` on a
token that demonstrably exists.

Pin SSR to a single resolution path (`bare specifier → Bun's
runtime resolver dedupes`, or `vendor file → one canonical path
in a Bun plugin`) and the dual-instance hazard goes away.
Build-time check `verifyAngularCoreUniqueness.ts` is the
regression guardrail.

### 3.10 `bun:wrap` virtual module + `node:*` stubs

Bun's TS transpiler emits `import { __legacyDecorateClassTS,
__legacyMetadataTS } from "bun:wrap"` for every legacy-decorator
class — i.e., every Angular component. The dev moduleServer must
serve `bun:wrap` as a virtual ESM exporting the standard TS
runtime helpers; otherwise the import leaks through as
`/@src/bun:wrap` with empty MIME and crashes the module-script
load.

Same shape for `node:*` builtins: detected upfront and routed to
`/@stub/<name>` (noop module). Without this, server-only code
that transitively reaches a browser bundle (e.g., an
`imageProcessing.ts` that imports `node:fs`) 404s the entire
import graph instead of evaluating the no-op import and moving
on.

### 3.11 Decorator-aware inheritance, not a blanket bail

`class Foo extends Bar` with `Bar` undecorated (a utility base
class) is the common case and merges into the child via the JS
prototype chain — no Angular metadata to combine. Only when
`Bar` itself carries `@Component` / `@Directive` / `@Pipe` /
`@Injectable` does ngc walk the heritage chain to merge metadata
upward, and only those cases need to fall back.

Naive heuristic ("any extends → bail") was over-conservative.
The fast extractor resolves the parent identifier via the source
file's import list (project-local), reads the parent class
declaration, and only bails if it has an Angular decorator.

### 3.12 Tier-routed user errors → overlay, not reload

Template parse failures, missing `templateUrl`, missing
`styleUrls` entries — these are typos. Reloading the page on
every keystroke until the user fixes them is hostile. Route them
to the existing `rebuild-error` overlay channel (the same one
React/Svelte/Vue use for build errors) and stay put. Next
successful save auto-dismisses.

This is what vite/next do. Now AbsoluteJS does it for Angular too.

### 3.13 Vendored LView slot ops for Tier 1a remount

`createComponent` is public, but `destroyLView` /
`replaceLViewInTree` / `cleanupLView` aren't. Tier 1a
per-component remount needs them. We vendor a minimal slice of
`@angular/core/src/render3` (LView/LContainer slot constants +
the operations we use) into `src/dev/client/vendor/lview/`.
Locked to a specific Angular minor; refresh on every Angular
update like the translator vendor.

### 3.14 Per-edit-type routing falls out of the dispatcher

The original Phase 2 plan called for separate code paths for
template / style / class / service edits. The surgical-tier
dispatcher made that split obsolete: any edit (any of `.ts`
`.html` `.css` `.scss`) gets resolved to the affected
component(s) via an inverted index, then `tryFastHmr` runs once
per affected component. One code path; the *what changed* is
expressed via fingerprint dimensions, not edit-type branches.

---

## 4. How we differ from the rest, and why it matters

| Dimension                          | Angular CLI    | Analog        | AbsoluteJS                |
|------------------------------------|----------------|---------------|---------------------------|
| Hot-path compiler                  | ngtsc          | ngtsc         | `compileComponentFromMetadata` direct |
| Template type-check on hot path    | yes (via TCB)  | yes (via TCB) | no (editor TS server)     |
| Single-file metadata extraction    | no             | no            | yes (TS AST walk)         |
| Surgical primitive                 | `ɵɵreplaceMetadata` | `ɵɵreplaceMetadata` | `ɵɵreplaceMetadata` |
| Cross-file dep resolution at HMR   | program-wide   | program-wide  | runtime via `__abs_deps`  |
| Bundle in dev                      | yes (esbuild)  | yes (Vite)    | no — moduleServer per-request |
| Non-standalone fast path           | yes            | yes           | yes (since beta.914)      |
| User-error overlay (template typo) | partial        | partial       | yes (vite/next-style)     |

The big-picture difference: AbsoluteJS treats Angular HMR as a
**metadata problem**, not a **compilation problem**. `ɵɵreplaceMetadata`
is the runtime contract; everything else is finding the cheapest
way to produce conforming metadata. The fast path is ~600 lines
of TS AST walking + a public IR call; the slow path (ngtsc) is
gone.

Why we're better:

- **Speed.** 4–50 ms vs 200–800 ms is the difference between
  "instant" and "perceptible." On a 250-component project, that's
  the difference between flow state and waiting.
- **Predictable.** Tier model + fingerprint means the developer
  can reason about what an edit will do. A method body edit is
  always Tier 0. Adding a constructor parameter is always Tier
  1a. There's no "sometimes ngtsc decides to recompile the
  world" outcome.
- **Diagnosable.** User-fixable failures show up in an overlay
  with file + line + column + the offending source line. Not
  a console error to scroll for.
- **Honest about the tradeoff.** We don't claim to do template
  type-checking on hot path. The editor does; we don't duplicate
  it.

Why we might *not* be better:

- A developer with no editor TS server (rare but real) loses
  template type-error feedback at save. They get it back at the
  next page reload or production build.
- Angular's compilation flags (`_strictTemplates`, custom JIT
  evaluators, etc.) aren't honored on the fast path. Default
  semantics only.
- Our coverage of the metadata surface tracks Angular's
  evolution. New IR fields require an extractor update. We
  watch for these on Angular minor bumps and have caught all of
  the ones in 17–21 so far.

---

## 5. The speed techniques, specifically

### 5.1 Single-file AST walk

`fastHmrCompiler.ts:tryFastHmr` reads one file, parses it with
`ts.createSourceFile` (no program), walks the class declaration
once. Cost: ~1–3 ms.

We extract:

- The `@Component` / `@Directive` / `@Pipe` / `@Injectable`
  decorator + its argument object literal.
- All member-level decorators (`@Input`, `@Output`,
  `@HostBinding`, `@HostListener`, `@ViewChild`,
  `@ContentChild`, etc.).
- Signal-based query / input / output calls (`viewChild`,
  `input`, `output`, `model`, plus `.required` chained variants).
- The constructor's parameter type list (for fingerprint).
- The class's heritage clause (for the decorated-parent
  inheritance check).
- All arrow-function class field initializers (for fingerprint;
  body changes here force Tier 1a because they live on the
  instance, not the prototype).

### 5.2 `compileComponentFromMetadata` direct call

Once the metadata is built, we call `compiler.compileComponentFromMetadata(meta, pool, bindingParser)`.
That's the same call AOT makes for every component, just driven
without a TS program. Cost: ~1–5 ms per component.

Output is a `R3CompiledExpression`; we wrap it in the
`Expression` shape `ɵɵreplaceMetadata`'s callback expects, run
the vendored translator (`translateStatement`) over the
statement list to get module text, and prepend the
`__abs_deps` destructure.

### 5.3 `compileComponentFromMetadata` + `WrappedNodeExpr` dodge cross-file work

The compile step doesn't need to know what `trigger`, `MyService`,
or `BehaviorSubject` resolve to — `WrappedNodeExpr` carries the
unresolved identifier through. The translator serializes them as
plain TS references; the surgical-update module's
`__abs_deps` destructure binds them at evaluation time.

### 5.4 No bundling in dev

`moduleServer.ts` serves files at `/@src/...` with a per-request
TS transform (Bun's transpiler), cached by source-hash.
`compileAngular` runs once at startup (and on Tier 1b
rebootstrap) to JIT every page's recursive Angular import graph
into `.absolutejs/generated/angular/`. Edits on a `.component.ts`
re-run `compileAngularFileJIT` on that single file and call
`invalidateModule` on the result; moduleServer serves the new
bytes on the next request.

The bundle path runs only at *initial* dev boot and on Tier 1b
rebootstrap. Steady-state edits never touch a bundler.

### 5.5 Resource-index-driven dispatch

`resolveOwningComponents.ts` maintains an inverted index:
`templateUrl` / `styleUrl` resource path → owning component
file. An edit on `hero.component.html` resolves to
`hero.component.ts` in O(1). The fast extractor then sees the
correct owner for fingerprint comparison and surgical update.

This is what makes "edit a `.html`, see it patched in <50 ms"
work. There's no edit-type discrimination; the dispatcher
collapses HTML/CSS/TS edits to the same surgical-update flow.

### 5.6 Fingerprint-based tier escalation

A short, identity-stable summary of each component's structural
surface (constructor type list, selector, standalone flag,
input/output names, provider import signature, arrow-field
hashes, member decorator signatures). On each edit we recompute
the fingerprint and compare to the cached one from the last
successful tier-0 / 1a / boot. Mismatch → Tier 1a remount;
match → Tier 0 surgical.

The fingerprint is intentionally **conservative on identity-
relevant changes** (anything that affects DI tree shape,
constructor signature, or per-instance state) and **lenient on
rendering changes** (template tweaks, method bodies, providers
list contents). The lenient side is what keeps the Tier 0 hit
rate high.

### 5.7 Static `__abs_deps` baked at initial bundle

`hmrInjectionPlugin.ts` runs at initial bundle time on every
Angular `.component.js` and emits, alongside the user's exports,
a `${ClassName}.__abs_deps = { TriggerFn, MyService, ... }`
record. The fast extractor doesn't have to *produce* this — it's
already there. Surgical-update modules just reference it.

### 5.8 No ngtsc, no `oldProgram`, no analysis cache

The original "slow path" cut used ngc's `performCompilation` with
`oldProgram` for incremental analysis. Cold start was 13–14 s,
incremental was ~1.5 s. After §3.1 + §3.2 + §3.6 closed the
metadata coverage gap, the slow path had no remaining use case
and was deleted (commit `aa95ad7`). 620 lines gone. Cold start
went from 14 s → 347 ms on a typical page edit; incremental from
1.5 s → ~70 ms.

### 5.9 Static-attr-to-input via declarations metadata

Without `R3DirectiveDependencyMetadata` per import, `Full` template
mode falls back to `ɵɵdomElement` for tags that *should* be
component matches, and static attrs (`<abs-image src="literal">`)
get encoded as DOM attributes instead of input bindings. The
visible failure mode is "the HMR'd page has empty src attrs."

The fix is paying the cost of resolving each import in the
extractor: read the imported module's exported `ɵcmp` /
`ɵdir` / `ɵpipe` from its `.ts` (project-local) or `.d.ts`
(library), build `R3DirectiveDependencyMetadata` with the
selector and inputs, hand it to the IR builder. That's enough
for `Full` mode to emit `ɵɵelement` and bind static attrs as
inputs.

### 5.10 In-page error overlay for parse failures

`ParseError.span.start` carries `{ line, col }`; the source file
content is on `span.start.file.content`. The fast extractor
captures the first error's location and the matching source
line, hands it back as `FastHmrFailure.{file, line, column,
lineText}`. The dispatcher converts to a `rebuild-error`
broadcast with `framework: 'angular'`; the existing client
overlay path renders it.

Cost: 0 ms on success path. On failure, the overlay shows up
within the same WS roundtrip as the failed update would have.

---

## 6. Where the bits live

- `src/dev/angular/fastHmrCompiler.ts` — the entire surgical-update
  builder. TS AST walk → `R3ComponentMetadata` →
  `compileComponentFromMetadata` → translator → module text. No
  ngc, no shadow program.
- `src/dev/angular/resolveOwningComponents.ts` — inverted index
  `templateUrl` / `styleUrls` → owning component class.
  Invalidated on any `.ts` edit (the import graph might have
  changed).
- `src/dev/angular/hmrInjectionPlugin.ts` — emits per-class
  `__ng_hmr_load` / `__ng_hmr_remount` listeners +
  `__abs_deps` registry into every Angular `.component.js`. Runs
  at initial bundle time AND in moduleServer per-request
  transform (same logic, two callers).
- `src/dev/angular/hmrCompiler.ts` — `/@ng/component?c=<id>&t=<ts>`
  endpoint dispatcher. Decodes id, resolves owning class,
  calls `tryFastHmr`, returns module text.
- `src/dev/angular/hmrImportGenerator.ts` — `ImportGenerator`
  implementation for the vendored translator so emitted modules
  use `globalThis.__angularHmr` (not `import.meta.hot`).
- `src/dev/angular/vendor/translator/` — vendored Angular
  `translateStatement` from compiler-cli. See `VENDORED.md`.
- `src/dev/client/handlers/angularHmrShim.ts` — runtime shim
  that registers the WS message bus on `globalThis.__angularHmr`.
- `src/dev/client/handlers/angularRemount.ts` +
  `angularRemountWiring.ts` — Tier 1a per-component destroy +
  recreate using vendored LView slot ops.
- `src/dev/client/vendor/lview/` — vendored LView / LContainer
  slot constants and operations from `@angular/core`'s render3
  internals.
- `src/dev/rebuildTrigger.ts` — `decideAngularTier`,
  `runAngularHmrIncremental` (JIT disk-refresh only),
  `broadcastSurgical`, `broadcastRemount`, `broadcastRebootstrap`,
  `broadcastAngularUserError`, the `handleAngularFastPath`
  orchestration.
- `src/dev/moduleServer.ts` — on-demand `.ts`/`.component.js`
  transformer; appends `applyAngularHmrInjection` per request,
  serves the `bun:wrap` virtual module, stubs `node:*` builtins.
- `src/dev/client/hmrClient.ts` — WS message handler. Routes
  `'angular:component-update'` / `'angular:component-remount'` /
  `'angular:rebootstrap'` to dispatch; eager-hides error overlay
  on every successful update.
- `src/build/compileAngular.ts` — JIT page transpile +
  `__ABS_ANGULAR_REBOOTSTRAP__` hook generation.
- `src/build/verifyAngularCoreUniqueness.ts` — build-time guardrail
  for the SSR multi-instance hazard (§3.9).
- `src/utils/cleanup.ts` — `preserveAngularGenerated` flag keeps
  `.absolutejs/generated/angular/` alive in dev when moduleServer
  is serving from it.

---

## 7. Honest caveats

1. **Template type-checking happens in the editor, not at HMR.**
   If you don't have a TS server open, you'll see template type
   errors at runtime / next page reload / next production build.
2. **Custom Angular compiler flags aren't honored on the fast
   path.** `strictTemplates`, custom JIT evaluators, etc. We use
   defaults. Production builds (full ngc) honor the project's
   tsconfig as expected.
3. **Coverage tracks Angular's IR.** When Angular adds an
   `R3ComponentMetadata` field, the extractor needs an update.
   We've covered every field in 17–21 so far; future minors may
   need ~30-line additions.
4. **One Angular core instance per SSR runtime.** Enforced by
   `verifyAngularCoreUniqueness` at build time; the dual-instance
   failure mode is invisible until a runtime `inject()` call hits
   the wrong injector.
5. **Vendored render3 internals are version-locked.** Tier 1a
   uses `@angular/core/src/render3` LView slot ops that aren't
   public. Refresh on every Angular minor.
6. **Inheritance from a decorated parent class falls back to
   Tier 1b.** Not a no-op — the rebootstrap path handles it
   correctly — just slower than Tier 0. Most extends-from-utility
   cases (the common pattern) stay on Tier 0 thanks to the
   decorator-aware check.

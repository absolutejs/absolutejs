# AbsoluteJS Angular Compiler Spec

## Purpose

This document sketches a possible long-term path for replacing the current
Angular AOT dependency with a faster AbsoluteJS-owned Angular compiler pipeline.
The goal is not to fork Angular casually. The goal is to evaluate whether a
modern compiler architecture, similar in spirit to Bun's native-first approach,
could make Angular builds meaningfully faster while preserving enough Angular
compatibility for AbsoluteJS applications.

## Current State

AbsoluteJS currently delegates production Angular compilation to Angular's
`@angular/compiler-cli` `performCompilation()` API. That gives us official AOT
semantics, template checking, decorator analysis, metadata handling, dependency
analysis, and emit compatibility.

Tracing on the dealroom app showed the build is dominated by Angular compiler
time:

- `compile/angular`: about 15-21s depending on run and package version.
- `compile/angular/aot/perform-compilation`: about 14-19s.
- Bun bundling phases: roughly 1-2s each for the relevant server/client passes.

The current AbsoluteJS wrapper around Angular AOT has already taken the most
obvious low-risk work out of the hot path:

- Angular entries are compiled through a shared compiler invocation.
- Unchanged source files are delegated back to TypeScript's compiler host
  instead of being re-created as custom `SourceFile` objects.
- Angular resource transforms are persisted under
  `.absolutejs/cache/angular-resources`, keyed by the TypeScript source,
  referenced `templateUrl` / `styleUrl(s)` contents, and style preprocessor
  config.
- Build traces expose Angular sub-phases and resource-cache behavior.

These optimizations are useful, but they mostly affect work around Angular's
compiler. The measured bottleneck remains `performCompilation()` itself.

## Non-Goals

- Full Angular CLI replacement on day one.
- Full ecosystem compatibility with every Angular package and compiler option.
- Reimplementing TypeScript itself.
- Reimplementing every Angular template type-checking diagnostic before proving
  build-speed wins.
- Changing public Angular runtime semantics in production output.

## Target Outcome

A successful AbsoluteJS Angular compiler would:

- Compile Angular standalone page components significantly faster than
  `@angular/compiler-cli` for AbsoluteJS app shapes.
- Emit browser and server-compatible JavaScript that works with Angular runtime
  packages.
- Preserve common Angular component semantics: decorators, inputs, outputs,
  host bindings, dependency injection metadata, templates, styles, pipes,
  directives, and standalone imports.
- Support the AbsoluteJS page model without requiring an Angular CLI project.
- Provide a compatibility escape hatch that falls back to official Angular AOT.

## Architecture Options

### Option A: Fast Frontend, Angular Emit

Build a fast native parser/indexer around Angular projects but still call
Angular compiler APIs for final emit.

Potential wins:

- Faster graph discovery.
- Faster template/style resource inlining.
- Better incremental cache invalidation.
- Less redundant host work.

Limits:

- Still bounded by `performCompilation()` for final AOT.
- Lower risk, but not a true compiler rewrite.

This is the pragmatic near-term path.

### Option B: Partial Compiler For AbsoluteJS Pages

Implement enough Angular compilation for AbsoluteJS page components and keep a
fallback for unsupported cases.

Scope:

- Standalone components.
- Inline and external templates.
- Inline and external styles.
- Common structural/control-flow syntax.
- Inputs, outputs, host bindings, and basic DI metadata.
- Common pipes/directives via imports.
- Server/browser emit compatible with Angular runtime.

Potential wins:

- Avoid Angular compiler's full program/template type-checking pipeline.
- Specialize for page components and known AbsoluteJS constraints.
- Use native code for parsing, template lowering, dependency graphing, hashing,
  and cache lookups.

Risks:

- Angular compatibility surface is large.
- Runtime-instruction output must track Angular internals.
- Template type-checking parity is expensive.
- Angular version drift could be costly.

### Option C: Full Angular Compiler Replacement

Build a complete compiler that parses TypeScript and Angular templates, performs
Angular semantic analysis, emits Ivy-compatible output, and type-checks
templates.

Potential wins:

- Maximum control.
- Potentially very fast cold and incremental builds.

Risks:

- Multi-year project.
- High compatibility burden.
- Angular private/internal emit details may change.
- Hard to justify before a partial compiler proves real wins.

This should be treated as a research track, not the next production milestone.

## Proposed Compiler Stack

### Native Core

Use Zig or Rust for performance-sensitive compiler services:

- File scanning.
- Hashing.
- Template lexing/parsing.
- CSS/resource dependency scanning.
- Import graph construction.
- Persistent cache indexing.
- Source map composition helpers.

Zig is attractive if the project wants Bun-like native integration and direct
control. Rust has stronger parser/compiler ecosystem options. Either can work;
the decision should be based on team capability and interoperability with Bun.

### JavaScript/TypeScript Layer

Keep orchestration in TypeScript initially:

- AbsoluteJS config integration.
- Framework build orchestration.
- Fallback decisions.
- Angular runtime compatibility glue.
- Testing harnesses.

The compiler can expose a native API to the TypeScript layer.

### Parser Strategy

TypeScript parsing is the hard boundary. Options:

- Use TypeScript compiler APIs for TypeScript ASTs, but avoid full Angular
  `performCompilation()`.
- Use a faster JS/TS parser such as SWC/OXC for syntax and only ask TypeScript
  for type information when needed.
- Add a later native TS semantic bridge only if benchmarks prove parsing is the
  bottleneck.

Initial recommendation: do not rewrite TypeScript semantics. Use fast parsing
for graph/template extraction, and keep official TypeScript APIs available for
validation and fallback.

## Compilation Pipeline

### 1. Project Graph

Build a stable graph of:

- Angular page entries.
- Local imports.
- Template URLs.
- Style URLs.
- Standalone component imports.
- Directive/pipe/provider exports.
- Angular package imports.

The graph should be cached by content hash and compiler version.

### 2. Decorator Analysis

Parse component decorators and extract:

- `selector`
- `template` / `templateUrl`
- `styles` / `styleUrl` / `styleUrls`
- `imports`
- `providers`
- `host`
- `changeDetection`
- `encapsulation`
- input/output metadata

Unsupported decorator expressions should fall back to Angular AOT.

### 3. Resource Loading

Inline and preprocess:

- HTML templates.
- CSS/SCSS/Sass/Less/Stylus where configured.
- AbsoluteJS `@defer` lowering.
- CSS module/resource references where applicable.

This is a strong native-cache candidate.

### 4. Template Compiler

Implement an Angular-template parser that lowers templates into an intermediate
representation:

- Elements.
- Text nodes.
- Interpolations.
- Property bindings.
- Event bindings.
- Two-way bindings.
- Control flow blocks.
- Structural directives.
- Pipes.
- Local references.
- Content projection.

The IR should be independent of Angular runtime emit so we can test it directly.

### 5. Semantic Resolution

Resolve template symbols against component imports:

- Components.
- Directives.
- Pipes.
- Inputs/outputs.
- Export aliases.

Start with standalone imports only. NgModule support can be fallback-only until
there is a clear business need.

### 6. Emit

Emit Angular runtime-compatible component definitions.

Possible emit modes:

- Ivy-compatible static fields.
- A thin runtime wrapper that uses Angular public APIs where possible.
- JIT-like generated code for dev and AOT-like generated code for production.

The safest first target is a constrained production emit for standalone page
components, with exhaustive fixture tests against Angular's output behavior.

### 7. Type Checking

Template type checking is the biggest compatibility challenge.

Phased approach:

1. Syntax and binding validation.
2. Directive/pipe existence checks.
3. Input/output name checks.
4. Optional TypeScript-powered template type-check blocks.
5. Full parity only where users rely on it.

The compiler should support a strict fallback mode where unsupported type-check
cases use official Angular AOT.

## Cache Strategy

The compiler should be designed around cacheability:

- Content-addressed source files.
- Separate template/style/resource hashes.
- Component-level output cache.
- Dependency graph cache.
- Angular package metadata cache.
- Compiler-version and Angular-version cache keys.

For production builds, a clean build can still reuse `.absolutejs/cache` if the
inputs are unchanged. A `--clean` output-directory delete should not delete the
compiler cache unless explicitly requested.

## Compatibility Strategy

Use a compatibility ladder:

1. Fast Absolute Angular compiler.
2. Fast compiler with TypeScript semantic assistance.
3. Official Angular AOT fallback for unsupported files/projects.

Every fallback should report why it happened when tracing is enabled.

Examples:

- Dynamic decorator object not statically analyzable.
- NgModule-only dependency graph.
- Unsupported template syntax.
- Unsupported Angular compiler option.
- Unknown Angular runtime version.

## Test Plan

### Fixture Parity

Build fixtures that compare behavior against official Angular AOT:

- Inputs and outputs.
- Host bindings/listeners.
- DI tokens.
- Pipes.
- Directives.
- Control flow.
- Forms.
- Router usage.
- Material/CDK components.
- HTTP transfer cache.
- SSR rendering.
- Hydration.

### Runtime Tests

Run browser and server tests for each fixture:

- SSR HTML output.
- Client hydration.
- Event handling.
- Input updates.
- Streaming/defer behavior.
- Error behavior.

### Performance Tests

Track:

- Cold build.
- Warm build.
- One-file change.
- Template-only change.
- Style-only change.
- Large page count.
- Large local import graph.

Benchmarks should compare:

- Official Angular AOT through AbsoluteJS.
- Angular CLI where applicable.
- AbsoluteJS native/fast compiler.
- Fallback rate.

## Milestones

### Milestone 1: Better Official AOT Wrapper

- Keep using Angular AOT.
- Preserve the shared compiler invocation for Angular entries.
- Preserve compiler-host delegation for unchanged source files.
- Preserve persistent resource-transform caching.
- Preserve trace metadata for Angular sub-phases and cache behavior.
- Only add official-AOT wrapper optimizations when measurements show they reduce
  work before `performCompilation()` or reduce inputs passed into it.

### Milestone 2: Static Analyzer

- Build a native or fast JS analyzer for Angular component decorators.
- Produce a component graph and resource graph.
- Validate against existing Angular fixtures.
- No custom emit yet.

### Milestone 3: Template IR

- Parse Angular templates into an AbsoluteJS IR.
- Snapshot test templates from real apps.
- Validate syntax and dependency discovery.

### Milestone 4: Fast Dev Compiler

- Emit JIT-compatible or runtime-compatible output for development.
- Keep production on official AOT.
- Optimize HMR and local edit latency first.

### Milestone 5: Production Subset Compiler

- Support standalone page components.
- Support common bindings, directives, pipes, DI metadata, styles, and SSR.
- Fall back for unsupported Angular features.
- Benchmark real apps.

### Milestone 6: Expanded Compatibility

- Add more Angular syntax and library patterns based on fallback telemetry.
- Introduce template type-checking tiers.
- Decide whether full compiler replacement is justified.

## Open Questions

- Is the first target dev/HMR speed, production build speed, or both?
- How much Angular compatibility does AbsoluteJS actually need?
- Are users willing to accept fallback messages for unsupported Angular patterns?
- Should template type checking remain official Angular-only at first?
- Should native code be Zig for project identity/performance, or Rust for parser
  ecosystem leverage?
- How often will Angular internal emit requirements change?

## Recommendation

Do not start with a full Angular compiler rewrite.

Start with a fast analyzer/cache layer and production AOT wrapper improvements.
Then build a constrained fast compiler for standalone AbsoluteJS Angular pages.
Keep official Angular AOT as the compatibility fallback until the fast compiler
proves it can handle real applications with a low fallback rate.

The core bet should be specialization: AbsoluteJS does not need to beat Angular
CLI for every Angular application on day one. It needs to beat it for the
AbsoluteJS app model while preserving a credible escape hatch.

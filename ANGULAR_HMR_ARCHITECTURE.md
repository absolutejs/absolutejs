# Angular HMR fast path: long-tail feature coverage

Reply to: "the only thing I'm unsure of is things like metadata
reconstruction and long-tail Angular features: imports, directives,
pipes, DI, host bindings, queries, defer blocks, input transforms,
etc. Angular gets really weird and sometimes just stupid with all
the edge cases in those areas."

Honest answer organized by difficulty tier.

## Tier 1: Trivial AST walks, just more emitter cases

Things that are "find a decorator/property on the class, copy a few
fields into `R3ComponentMetadata`":

- **Host bindings / host listeners** — `@HostBinding('class.foo')`,
  `@HostListener('click')`, or `host: { '[class.foo]': '...' }`.
  Walks class decorators + the decorator object literal. Maps to
  `R3HostMetadata`. ~50 lines of TS AST code.
- **Queries** — `@ViewChild`, `@ContentChild`, signal-based
  `viewChild()`. Maps to `R3QueryMetadata[]`. Selector resolution is
  the only cross-file part and it's lazy.
- **Input transforms** — `@Input({ transform: numberAttribute })`.
  The transform is just an `Expression` reference, we wrap it as
  `WrappedNodeExpr`. No actual function evaluation needed — that's
  runtime's job.
- **Signal-form inputs/outputs** — `input()`, `output()`, `model()`.
  Detection is "is the initializer a call to a known symbol from
  `@angular/core`." `isSignal: true` flag flips. Otherwise identical
  to decorator-form.
- **Animations** — `animations: [trigger(...)]` is an opaque
  `Expression` to the compiler. Pass-through.
- **`exportAs`, `providers`, `viewProviders`, `schemas`** — pass-through.

These are real engineering work but no architectural risk. ~1 day
each, mechanical.

## Tier 2: Needs cross-file resolution but cacheable

This is where the instinct that "it gets weird" is most justified,
but it's also where the cache wins big.

- **`imports: [CommonModule, MyDir, MyPipe]` on standalone
  components** — for each entry, we need to know: is it a class, an
  NgModule, a pipe? what's its selector? what does it re-export?

  **Trick:** the runtime supports passing the *raw class reference*
  as a dependency, not just the resolved selector. `dependencies:
  [CommonModule]` works because the runtime introspects
  `CommonModule.ɵmod.declarations` itself. We don't have to expand
  transitively at compile time. AOT does the expansion only for
  tree-shaking — irrelevant in dev.

  So `imports: [CommonModule, MyDir]` becomes `dependencies:
  [CommonModule, MyDir]` in our IR. No cross-file analysis needed.

- **Constructor DI** — `constructor(private foo: FooService)` needs
  an `ɵfac` factory that injects `FooService`. **Critical insight:**
  for HMR specifically, if the constructor signature didn't change,
  we don't need to re-emit `ɵfac` at all. `ɵɵreplaceMetadata` only
  swaps the fields we provide. The old factory keeps working. We
  re-emit `ɵfac` only when the constructor changed, and that's
  almost always a structural change that warrants a fuller reload
  anyway.

  For the cases we do need to handle: walk constructor params, find
  their type references, emit `ɵɵdirectiveInject(TypeRef)` calls.
  ~100 lines.

- **`inject()`-based DI** — much easier. The factory is just `() =>
  new ClassName()` because `inject()` calls happen inside the
  constructor body. No metadata extraction needed.

## Tier 3: Hard cases — fall back to ngtsc

Honest list of what we won't try to fast-path in v1:

- **NgModule-based components** (non-standalone). Their dependency
  scope comes from their containing NgModule, which comes from
  siblings in the module's `declarations: [...]`. Genuinely needs
  program-wide analysis. Detection is one line: `if (!isStandalone)
  → fallback`.
- **Inheritance chains with decorated parents** — `class Foo extends
  Bar` where `Bar` has its own `@Component`. ngtsc merges metadata
  up the chain. We could do this but it's a meaningful chunk of
  work; v1 falls back. Detection: check heritage clauses + see if
  the parent has a decorator.
- **Components with `@defer` blocks that have explicit
  dependencies** — `parseTemplate` handles the parsing, but
  `R3ComponentDeferMetadata` in PerBlock mode requires a per-block
  dependency function. We can use PerComponent mode with
  `dependenciesFn: null` for many cases, but some patterns force
  PerBlock. Fall back when we detect `@defer (on viewport)` or
  `@defer (when ...)` with explicit dep references.
- **Forward references with cycles** — `forwardRef(() => Foo)`.
  Tractable but rare; punt to v2.
- **Components that depend on compilation flags that affect
  codegen** — `_strictTemplates`, `useTemplatePipeline`, etc. We use
  defaults; if a project has unusual compiler flags, fast path may
  diverge from AOT. We'd detect non-default flags in tsconfig and
  fall back globally.

## The composition

Detection runs ~10ms before we commit to fast vs slow path:

```
parse the .ts file (single-file, no program)
walk the @Component decorator
  if class extends a decorated parent → fallback
  if @Component is missing standalone:true → fallback
  if @defer blocks with explicit deps → fallback
  if (advanced patterns we haven't covered yet) → fallback
otherwise → fast path
```

Fast path: ~5ms, runs.
Slow path: ngtsc incremental (~1-3s), runs.

Falling back is **safe** — it's the path Angular's been on for
years. We're additive: fast path is a strict optimization, never a
regression.

## Coverage estimate

For modern Angular (17+, signal-based, standalone-first) codebases
— the kind a new project would have — fast path covers ~85-95% of
components on day one. Legacy NgModule-based codebases get covered
less initially. Each edge case we hit becomes either a new emitter
case (Tier 1) or a fallback condition (Tier 3). Coverage grows with
usage, never shrinks.

## Direct mapping of the listed concerns

- **Imports** → covered (pass-through to runtime)
- **Directives** → covered (same)
- **Pipes** → covered (same)
- **DI** → covered for `inject()`, and for constructor DI when
  signature is stable; structural changes fall back
- **Host bindings** → Tier 1, mechanical AST walk
- **Queries** → Tier 1, mechanical AST walk
- **Defer blocks** → covered for simple cases (`@defer (on idle)`);
  explicit-dep patterns fall back to ngtsc
- **Input transforms** → Tier 1, pass-through

The surface area is real, but it's mostly in the **metadata
extraction** (TS AST walking), not in the **IR generation** — and
the IR generation is the hard part, which
`compileComponentFromMetadata` already solves for us. We're writing
a metadata extractor, not a compiler.

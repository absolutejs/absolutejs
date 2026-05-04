# Vendored from angular/angular

These files are an unmodified, exact copy of Angular's compiler-cli
translator subsystem at tag **v21.2.6**. They translate
`@angular/compiler`'s output AST (`o.Statement`, `o.Expression`)
into TypeScript AST nodes, which we then print as ES2022 via
`ts.printer` + `ts.transpileModule`.

## Why vendored

`@angular/compiler-cli` exports a public surface (`performCompilation`,
`readConfiguration`, `linker/*`) but does **not** expose
`translateStatement` / `translateExpression`. Our HMR fast path
needs them: after we hand-roll component metadata and call
`compileComponentFromMetadata` + `compileHmrUpdateCallback`, the
result is an `o.DeclareFunctionStmt` — Angular's output AST — and
we have to convert that to TypeScript before the printer can
render it as JS source.

Writing our own emitter looked tractable at first (~150 lines for
the subset needed in HMR callbacks), but Angular's translator has
years of edge-case patches we'd reinvent: BinaryOperator value
mismatches across versions, downlevel handling for tagged
templates, source map preservation, identifier escaping in object
keys, parenthesization around assignment-as-expression. Vendoring
the upstream copy is closer to "use the framework's own pipeline"
and survives Angular minor upgrades better.

## Files

All seven were pulled verbatim from
`packages/compiler-cli/src/ngtsc/translator/src/`:

- `typescript_translator.ts` — entry points (`translateStatement`,
  `translateExpression`)
- `translator.ts` — `ExpressionTranslatorVisitor`, the visitor that
  walks output AST and emits via `AstFactory`
- `typescript_ast_factory.ts` — `TypeScriptAstFactory`, concrete
  TS-emitting `AstFactory`
- `ts_util.ts` — `tsNumericExpression` helper used by the AST
  factory for numeric literal emission
- `context.ts` — translation `Context`
- `api/ast_factory.ts` — `AstFactory` interface + supporting types
- `api/import_generator.ts` — `ImportGenerator` interface

Notably **not** vendored: the `import_manager/` subdirectory.
Angular's `ImportManager` is ~35KB and assumes it's emitting
imports at module scope. HMR update modules have no imports —
all external symbols arrive as function parameters
(`CounterComponent`, `ɵɵnamespaces`, ...). Our own
`hmrImportGenerator.ts` (next to `fastHmrCompiler.ts`) implements
the `ImportGenerator` interface in ~30 lines: it returns inline
`ɵhmr<i>.<symbol>` property-access expressions for every external
ref the translator asks about, so no import statements get emitted.

## Refresh procedure

When upgrading Angular (major or minor), re-pull from the matching
tag:

```sh
TAG=v<X.Y.Z>
BASE=packages/compiler-cli/src/ngtsc/translator/src
DEST=src/dev/angular/vendor/translator
gh api repos/angular/angular/contents/$BASE/typescript_translator.ts?ref=$TAG --jq '.content' | base64 -d > $DEST/typescript_translator.ts
gh api repos/angular/angular/contents/$BASE/translator.ts?ref=$TAG --jq '.content' | base64 -d > $DEST/translator.ts
gh api repos/angular/angular/contents/$BASE/typescript_ast_factory.ts?ref=$TAG --jq '.content' | base64 -d > $DEST/typescript_ast_factory.ts
gh api repos/angular/angular/contents/$BASE/context.ts?ref=$TAG --jq '.content' | base64 -d > $DEST/context.ts
gh api repos/angular/angular/contents/$BASE/api/ast_factory.ts?ref=$TAG --jq '.content' | base64 -d > $DEST/api/ast_factory.ts
gh api repos/angular/angular/contents/$BASE/api/import_generator.ts?ref=$TAG --jq '.content' | base64 -d > $DEST/api/import_generator.ts
```

Then run the HMR fast-path tests; structural changes in the
translator API (new visitor methods, AstFactory signature shifts)
will surface as type errors in our `hmrImportGenerator.ts`.

## License

The vendored files retain Angular's per-file MIT license headers.
Angular itself is MIT-licensed
(`https://angular.dev/license`):

```
The MIT License

Copyright (c) 2010-2026 Google LLC. https://angular.dev/license

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OF OTHER DEALINGS IN
THE SOFTWARE.
```

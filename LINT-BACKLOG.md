# Lint conformance backlog

Status of bringing the repo to a clean `bun run lint` (`absolute eslint`, plugin `eslint-plugin-absolute@0.11.1`).

## Progress

- Start: **1,613 errors** / 252 warnings.
- Now: **1,063 errors** (~34% cleared), build + typecheck green throughout.
- Lint is **not** in the `release` pipeline, which is how this backlog accumulated after the ruleset was tightened (`a4b9e46 "eslint studio rule manager + lint config cleanup"`).

### Done
- `eslint --fix` mechanical pass (sorted keys, blank-line padding) — 432.
- `no-return-await`, `consistent-return`, `consistent-type-definitions` (Window aug → disable, declaration merging required).
- `no-explicit-return-type`: stripped 78 + a recursion-rule round; **only ever edited at ESLint-flagged ranges** (the rule has allowances — never blanket-strip).
- **Plugin fix:** `eslint-plugin-absolute@0.11.1` adds a self-reference allowance to `no-explicit-return-type` — recursive functions need the annotation (TS7023); this was a real rule gap, not a workaround.
- `no-empty-function`, most `no-nested-ternary`.

## Remaining: 1,063 errors

### Behavior-risky (do carefully, verify per file) — held
| count | rule | notes |
|---|---|---|
| 451 | `absolute/max-depth-extended` (max 1) | control-flow refactors (extract helpers / early returns); concentrated in dev/angular + build |
| 107 | `@typescript-eslint/consistent-type-assertions` (never) | removing `as` can mask real type errors; many are unavoidable AST casts → may need refactor or per-line disable |
| 30 | `@typescript-eslint/no-non-null-assertion` | replace `!` with guards/`??` |
| 18 | `no-await-in-loop` | parallelizing changes concurrency semantics — judge per case |
| 105 | `absolute/no-explicit-return-type` | the 9 inference-anchor / **mutual-recursion** files (e.g. `fromType.ts` `toSchema`↔`single`): refactor to infer, extend the rule for mutual recursion, or per-line disable |

### Mechanical (lower risk, still manual — no autofix path)
| count | rule | approach |
|---|---|---|
| 111 | `absolute/min-var-length` | scope-aware renames (≥3 chars; allowed shorts in config) |
| 40 | `prefer-destructuring` | `const x = obj.x` → `const { x } = obj` (these are `arr[i]`/reassign forms, not auto-fixable) |
| 25 | `promise/param-names` | rename executor params → `resolve`/`reject` |
| 21 | `@typescript-eslint/no-unused-vars` | remove / prefix `_` |
| 20 | `no-shadow` | rename shadowing bindings |
| 15 | `@typescript-eslint/no-unused-expressions` | |
| 13 | `absolute/explicit-object-types` | annotate object literals with named types |
| 9 | `absolute/sort-keys-fixable` | non-autofix positions |
| 9 | `no-restricted-exports` | default → named export |
| 7 | `promise/catch-or-return` | |
| 6 | `preserve-caught-error` | add `{ cause }` (needs the catch var in scope) |
| 6 | `no-restricted-syntax` | IIFE ban → extract named fn |
| 5 | `func-style`, 5 `no-useless-function`, 5 `no-require-imports`, 3 `no-duplicate-imports`, 2 `no-nested-ternary`, 2 `no-useless-assignment`, 1 `no-loop-func` | |

### Render-affecting (JSX) — judge per component
| count | rule |
|---|---|
| 16 | `absolute/no-unnecessary-div` (move styles to surrounding element) |
| 13 | `absolute/max-jsxnesting` (extract subcomponents) |
| 7 | `absolute/localize-react-props` |

### Config decisions needed (not code fixes)
- **`tests/fixtures/**` (32 errors)** — these are test *inputs*, several intentionally invalid: `cjs-probe.cjs` uses `require` by design (`no-require-imports`/`no-undef`), `BoomPage` throws by design, plus `package.json`/`tsconfig.json`/`data.json` (the `null`-ruleId errors = JSON). **Recommend adding `tests/fixtures/**` to eslint `ignores`** rather than editing them.
- `src/cli/scripts/dev.ts:356` `no-control-regex` — the ANSI `\x1b` regex is intentional → `eslint-disable-next-line` with reason.
- Pre-existing **typecheck** error (not lint, not mine): `tests/fixtures/compile-stress/server.ts:29` from commit `3782f2d` — `BoomPage` (`() => void`) passed where `ComponentType` expected.

## Top files (errors)

```
268  src/dev/angular/fastHmrCompiler.ts
 98  src/dev/rebuildTrigger.ts
 40  src/core/build.ts
 32  src/vue/staticAnalyzeSpaRoutes.ts
 30  src/dev/client/handlers/angularRemount.ts
 28  src/angular/staticAnalyzeSpaRoutes.ts
 28  src/dev/angular/resolveOwningComponents.ts
 26  src/react/staticAnalyzeSpaRoutes.ts
 20  src/cli/scripts/compile.ts
 20  src/cli/scripts/dev.ts
```

## Recommended approach for the dedicated pass

Go **file-by-file to zero** (mechanical + max-depth together, since they co-occur), `typecheck` + `build` + commit per file, starting with the densest. The 4 `staticAnalyzeSpaRoutes.ts` files share a shape — fix one, mirror the rest. Re-run `bunx eslint . -f json` for fresh locations after each batch (positions shift).

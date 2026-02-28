# Angular HMR: Bun.Transpiler Optimization (Blocked on Bun Bug)

## Summary

Replace `ts.transpileModule()` with `Bun.Transpiler` in the Angular JIT compilation path to eliminate the single biggest HMR bottleneck. Currently blocked by a Bun bug where `experimentalDecorators: true` is ignored.

**Tracking issue**: https://github.com/oven-sh/bun/issues/27575
**Related PR**: https://github.com/oven-sh/bun/pull/27527

## The Problem

Angular HMR server-side rebuild takes 200-650ms. Profiling shows the breakdown:

| Step | Time | File |
|------|------|------|
| `ts.transpileModule()` per changed file | 12-150ms | `src/build/compileAngular.ts` |
| `compileAngular()` wrapper (file I/O, index gen) | 100-580ms | `src/build/compileAngular.ts` |
| `Bun.build()` client bundling | 70-155ms | `src/dev/rebuildTrigger.ts` |

The wrapper and bundling overhead have already been optimized with caching (see `wrapperOutputCache` and `allIndexesUnchanged` in the current code). The remaining bottleneck is `ts.transpileModule()` itself.

## What to Do When the Bug is Fixed

Once Bun's `Bun.Transpiler` correctly emits legacy decorators when `experimentalDecorators: true` is set in tsconfig, make these changes:

### 1. Replace `ts.transpileModule()` with `Bun.Transpiler` in `compileAngularFileJIT()`

**File**: `src/build/compileAngular.ts`, inside `compileAngularFileJIT()`

The function currently has a `transpileOpts` object and calls:

```ts
const result = ts.transpileModule(sourceCode, {
    compilerOptions: transpileOpts,
    fileName: actualPath
});
let processedContent = result.outputText;
```

Replace with:

```ts
const bunTranspiler = new Bun.Transpiler({
    loader: 'ts',
    target: 'browser',
    tsconfig: JSON.stringify({
        compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true
        }
    })
});

// Inside transpileFile(), replace the ts.transpileModule call:
let processedContent = bunTranspiler.transformSync(sourceCode);
```

Move the `bunTranspiler` instantiation outside `transpileFile()` (next to the existing `transpileOpts`) so it's created once per `compileAngularFileJIT()` call, not per file.

### 2. Verify the Output

The compiled output MUST use legacy `__decorate()` calls, NOT `bun:wrap` TC39 helpers. Check for:

- `__decorate([...], Prototype, "propName", void 0)` — legacy (correct)
- `import { __decorateElement } from "bun:wrap"` — TC39 (broken for Angular JIT)

Angular's JIT runtime throws `"Standard Angular field decorators are not supported in JIT mode"` when it receives TC39 field decorators because the calling convention is incompatible (`target === undefined` vs `target === prototype`).

### 3. Test Checklist

```bash
bun run dev  # Start dev server
```

1. Open `/angular` in the browser
2. Edit `example/angular/components/counter.component.ts` — change the `increment()` method body
3. Verify HMR updates without errors in the server console
4. Verify the counter component renders correctly
5. Click the counter a few times, then edit again — verify state is preserved
6. Check the HMR timing in the console — should be faster than before (target: <100ms for warm edits)
7. Run `bun run typecheck` — should pass (ignore pre-existing errors in `example/react/`)

### 4. Remove `ts` Import If Possible

After switching to `Bun.Transpiler`, the `ts` (typescript) import is only needed by the AOT path (`compileAngularFile()`). If that function is not used in the JIT/HMR code path, consider lazy-importing it only in `compileAngularFile()` to avoid loading the full TypeScript compiler during dev.

## Why This Matters

`Bun.Transpiler` is a native Zig-based transpiler. In our testing, it's roughly 10x faster than `ts.transpileModule()` for individual files. For Angular HMR, this would reduce the per-file transpile time from ~100-150ms to ~10-15ms, making the total HMR cycle consistently under 100ms.

## What's Already Been Done

These optimizations are already in the codebase and should NOT be reverted:

1. **Wrapper output cache** (`wrapperOutputCache` in `compileAngular.ts`): Skips re-reading compiled files, rewriting server files, injecting HMR registration, writing SSR deps, and generating index files when the compiled output hasn't changed. Saves ~100-500ms.

2. **Bundle skip** (`allIndexesUnchanged` returned from `compileAngular()`, checked in `rebuildTrigger.ts`): Skips the entire `Bun.build()` call when client index files haven't changed. Saves ~70-155ms.

3. **Client-side fast update** (`handleFastUpdate` in `src/dev/client/handlers/angular.ts`): Tries runtime prototype patching via `window.__ANGULAR_HMR__.applyUpdate()` before falling back to full destroy/re-bootstrap. Eliminates ~100-150ms of client-side bootstrap time for most edits.

4. **Registry exposure** (`getRegistry()` in `src/dev/client/handlers/angularRuntime.ts`): Exposes the component registry so the client handler can check registered components for the fast update path.

## Background Context

- Angular 21 supports TC39 decorators in AOT mode but NOT in JIT mode for field decorators (`@Input`, `@Output`, `@ViewChild`, etc.)
- The project uses JIT compilation for dev/HMR because AOT (`performCompilation()`) takes ~500-700ms vs ~50-100ms for JIT
- Bun 1.3.10 added TC39 decorator support but broke the `experimentalDecorators` flag — it always emits TC39 regardless of the setting
- The `ts.transpileModule()` fallback works correctly but is the bottleneck we want to eliminate

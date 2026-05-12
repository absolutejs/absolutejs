# Bun — `Bun.build` does not chain through input inline sourcemaps

**Tracking:** [oven-sh/bun#30536](https://github.com/oven-sh/bun/issues/30536)
— the file-input variant we filed. Cross-references the plugin-input
sibling [oven-sh/bun#6173](https://github.com/oven-sh/bun/issues/6173)
(open since 2023-09-29) and the in-progress draft PR
[#20865](https://github.com/oven-sh/bun/pull/20865) by Jarred Sumner
(adds `sourcemap` field on `BunPlugin.onLoad` return values and the
`LinkerContext.zig` plumbing to consume it). Same root cause: Bun's
bundler doesn't compose `//# sourceMappingURL=` comments from input
modules when emitting its output sourcemap. #20865's linker plumbing
likely covers the file-input case too once a small lexer-side wiring
patch lands (feeding `lexer.source_mapping_url` into the same
pipeline #20865 consumes plugin-provided sourcemaps from).

**Status:** Reproduces on Bun 1.3.14-canary.1+fe735f8f0. **Action
when fixed:** see "What to do when Bun fixes it" at the bottom.

## What's wrong upstream

`Bun.build({ sourcemap: 'inline' })` emits a sourcemap from the final
bundle to each `entrypoint`'s file content — but if any `entrypoint`
already carries its own inline `//# sourceMappingURL=...` comment
(because some upstream tool, e.g. a `.vue`/`.svelte`/`.ts` compile step,
produced that intermediate from a deeper source), `Bun.build` reads the
file's bytes (including the inline comment as literal text in
`sourcesContent`) but does NOT chain through that map. The resulting
output map's deepest `sources[]` entries are the intermediate files —
not the original sources the developer actually edits.

Other modern bundlers (esbuild, Rollup, Vite) honour input inline
sourcemaps by default and compose them through to the output. Bun
appears to ignore them.

### Minimal repro

```ts
// inner.ts — the "original" source
export const x = 5;
throw new Error('inner-source-throw');
```

```ts
// Build inner.js from inner.ts with an inline sourcemap pointing back.
import { writeFileSync, readFileSync } from 'node:fs';
const src = readFileSync('inner.ts', 'utf-8');
const map = {
  version: 3,
  sources: ['inner.ts'],
  sourcesContent: [src],
  names: [],
  mappings: src.split('\n').map((_, i) => (i === 0 ? 'AAAA' : 'AACA')).join(';')
};
const inline = `\n//# sourceMappingURL=data:application/json;base64,${
  Buffer.from(JSON.stringify(map)).toString('base64')}\n`;
writeFileSync('inner.js', src + inline);
```

```ts
// entry.ts
import { x } from './inner.js';
console.log(x);
```

```ts
// run-build.ts
const result = await Bun.build({
  entrypoints: ['entry.ts'],
  outdir: 'out',
  format: 'esm',
  target: 'bun',
  sourcemap: 'inline'
});
const text = Bun.file(result.outputs[0].path).text();
// Decode the inline sourcemap on out/entry.js.
// Expected: sources contains 'inner.ts' (chained through).
// Actual:   sources contains 'inner.js' (chain stopped at the input).
```

Output (Bun 1.3.14-canary.1):

```
sources: [ "../inner.js", "../entry.ts" ]
sourcesContent[0] (first 80 chars):
  export const x = 5;
  throw new Error('inner-source-throw');
  //# sourceMappingURL=data:application/js...
```

`sourcesContent[0]` includes the original inline sourcemap comment as
LITERAL TEXT, confirming Bun read the file's bytes but did not parse
or compose the inner map.

## How it bit AbsoluteJS

The Vue SSR compile pipeline emits intermediates under
`.absolutejs/generated/vue/server/pages/<Page>.js`. Each intermediate
is the output of `@vue/compiler-sfc`'s `compileScript` followed by
Bun.Transpiler TS-stripping, then concatenation with render-fn code
and Vue-import consolidation. The intermediate carries an inline
sourcemap pointing back to the `.vue` source (we generate it from
compileScript's emitted map plus a content-derived line-remap that
accounts for Bun.Transpiler's blank-line drops and
`mergeVueImports`'s consolidation).

`Bun.build` is then called with `sourcemap: 'inline'` to bundle these
intermediates into hashed SSR bundles under
`example/build/vue/server/pages/<Page>.<hash>.js`. Bun.build's output
map correctly maps `final.<hash>.js:53:11` back to the intermediate
`.../VueExample.js:10:11`. But because Bun.build doesn't chain the
intermediate's inline map onward, stack traces for thrown SSR errors
stop at the intermediate JS — developers see a frame pointing at a
file under `.absolutejs/generated/` instead of the `.vue` source they
edit. The intermediate file path / line numbers are correct, just one
hop too shallow.

## What we did on our side

`src/build/chainInlineSourcemaps.ts` — a ~200-LOC self-contained
chainer (no external deps). It exports:

- `chainBundleInlineSourcemap(bundleFilePath)` — reads the bundle's
  inline sourcemap, extracts inner maps directly from the embedded
  `sourcesContent[]` (which holds each intermediate's full text
  including its inline `sourceMappingURL` comment), composes the
  chain in-process, and rewrites the bundle's inline map.
- `buildLineRemap(before, after)` + `remapGeneratedLines(mappings, remap)` —
  utilities `compileVue` uses to remap `compileScript`'s emitted
  sourcemap from its own pre-transpiler line layout to the actual
  written intermediate's line layout.

Wired into two places:

1. `src/dev/rebuildTrigger.ts` — `runVueBundleRebuild` calls the
   chainer on every Vue SSR bundle output post-build.
2. `src/core/build.ts` — the initial dev-mode server build sets
   `sourcemap: 'inline'` and runs the chainer post-Promise.all.

The Vue compile pipeline (`src/build/compileVue.ts`) also got
`sourceMap: true` passed to `compileScript`, plus the inline-map
emission with the content-derived line remap.

Result: SSR error stack frames now resolve to e.g.
`/home/alex/example/vue/pages/VueExample.vue:2:11` — the actual `.vue`
file the developer edits. Verified end-to-end by
`tests/integration/hmr/lifecycle/sourcemap-stack-traces.test.ts`.

The chain is currently Vue-only. Svelte / Angular SSR build paths emit
no inline sourcemap on their intermediates (their `compile*.ts` files
don't pass `sourceMap: true` through to the underlying compiler), so
the chainer would no-op there even if hooked up — extending coverage
is straightforward but not yet done.

## What to do when Bun fixes it

When `Bun.build` chains through input inline sourcemaps automatically,
the chainer becomes dead weight. Delete in this order:

1. Remove the `chainBundleInlineSourcemap` call sites:
   - `src/dev/rebuildTrigger.ts` (`runVueBundleRebuild`'s
     post-Promise.all loop over server / client outputs).
   - `src/core/build.ts` (post-Promise.all block guarded by `isDev`).
2. Delete `src/build/chainInlineSourcemaps.ts`.
3. Inline `buildLineRemap` / `remapGeneratedLines` callers in
   `src/build/compileVue.ts` keep working because they don't depend
   on the chainer — they shape the intermediate's own inline map. The
   `inlineSourceMapFor` helper inside `compileVue.ts` keeps emitting
   the inline `//# sourceMappingURL=...` comment on each intermediate.
   Bun.build's chained behavior consumes it directly.
4. Tighten or keep
   `tests/integration/hmr/lifecycle/sourcemap-stack-traces.test.ts`
   — the `VueExample.vue` assertion still holds; only the path the
   chain travels changes.
5. Mark this file resolved and remove the open-issues entry from
   `HMR_COVERAGE.md`.

No version pinning required — the chainer's behavior is idempotent
when Bun does the work itself (composing a map that already points at
`.vue` files just produces the same map). So we could ship the
chainer alongside a Bun version that chains correctly without harm
while we wait to clean up.

# Ember Adapter — Active Bandaids

Workarounds we ship today because of upstream constraints. Each entry
documents what's blocking us and what to do when the upstream fix lands.

---

## 1. Bun resolver doesn't honor `@`-prefixed subpaths in wildcard `exports`

**Issue**: [oven-sh/bun#30187](https://github.com/oven-sh/bun/issues/30187)

**What's broken**: `ember-source@6.12`'s `package.json` declares
`"exports": { "./*": "./dist/packages/*" }`. The Node ESM spec says
wildcards substitute literally, so `import "ember-source/@ember/renderer/index.js"`
should map to `node_modules/ember-source/dist/packages/@ember/renderer/index.js`.
Node.js handles this correctly; Bun returns
`Cannot find module 'ember-source/@ember/renderer/index.js'` whenever the
matched substring starts with `@`. Plain subpaths (e.g.
`ember-source/ember/index.js`) work; only `@`-prefixed ones fail.

This breaks every `@ember/*` and `@glimmer/*` import that ember-source
emits internally — and the post-monorepo-merger world makes those the
majority of Ember runtime imports.

**Bandaid**:

- `src/build/buildEmberVendor.ts` — `createEmberResolverPlugin` is a
  Bun.build plugin that intercepts every `@ember/*`, `@glimmer/*`, and
  `@simple-dom/*` resolution and routes it to the absolute file path
  inside `node_modules/ember-source/dist/packages/<spec>/index.js`.
- `src/build/compileEmber.ts` — `createEmberServerResolverPlugin` is the
  same shape, applied to the server-side Bun.build pass that bundles
  user pages with their transitive Glimmer/Ember runtime deps.

**What to do when unblocked**:

1. Verify the fix lands by testing the `Bun.resolve` reproducer from
   issue #30187 against the new Bun version.
2. Delete `createEmberResolverPlugin` from `buildEmberVendor.ts` and
   `createEmberServerResolverPlugin` from `compileEmber.ts`. Their
   `onResolve` hooks for `@ember/*`, `@glimmer/*`, `@simple-dom/*`
   become no-ops.
3. Vendor entries can switch from `EmberSpecifierResolution`'s
   `resolveTo` field (currently the absolute path) back to the bare
   specifier — Bun's resolver handles it.
4. The macros virtual-module half of the resolver plugin must STAY
   regardless — that's a separate concern (see #2 below).
5. Bump the minimum Bun version in `package.json` to whichever release
   ships the fix, and add a one-line note in `EMBER_PLAN.md §0` so the
   `@`-prefix workaround stops being a phase-1 implementation
   constraint.

**How to spot when it's been fixed**: GitHub closes #30187 with the fix
release linked, AND the reproducer in the issue body returns the
absolute path on the new Bun.

---

## 2. `@embroider/macros` runtime stubs intentionally throw

**Issue**: not a bug — by design. Embroider's macros are compile-time
replacements; the runtime `index.js` deliberately throws so misuse fails
loudly. We don't run Embroider's babel plugin (we use Bun.Transpiler
instead), so the throws fire when ember-source imports `isDevelopingApp`
at module evaluation time.

**Bandaid**:

- `src/build/compileEmber.ts` — `createEmberServerResolverPlugin` virtualizes
  `@embroider/macros` to a generated shim with NODE_ENV-based
  `isDevelopingApp`, no-op `setTesting`, identity `macroCondition`, etc.
- `src/build/buildEmberVendor.ts` — same shim wired via the vendor
  resolver plugin.

**Status**: This is **not a true bandaid** — it's the correct
implementation for a non-babel build pipeline. There's no upstream fix
to wait for. Listed here for posterity so future maintainers don't
mistake it for a bug we're papering over.

The only thing that would change this is if Ember/Embroider ever ship a
real-runtime macros build (analogous to how Vue ships dev/prod runtime
modes). The repo at `embroider-build/embroider` is the place to watch.

---

## 3. `@ember/renderer` reads `globalThis.Element`

**Issue**: [emberjs/ember.js#21363](https://github.com/emberjs/ember.js/issues/21363)
**Fix PR**: [emberjs/ember.js#21364](https://github.com/emberjs/ember.js/pull/21364)
(both filed by us — same audit context as EMBER_PLAN §0.1)

**What's broken**: `@ember/renderer`'s `renderComponent` does
`if (into instanceof Element)` to decide whether to clear `innerHTML`
on the target element. The check assumes a global `Element` constructor
exists — true in browsers and in FastBoot (which sets up DOM globals),
but false in Node/Bun running with a bare `@simple-dom/document`. We
get `ReferenceError: Element is not defined` before render starts.

**Bandaid**:

- `src/ember/pageHandler.ts` — `installSimpleDomGlobals()` sets
  `globalThis.Element = class {}` and `globalThis.Node = class {}` if
  missing. simple-dom nodes don't extend these, so the
  `into instanceof Element` check returns false and the
  innerHTML-clearing branch is skipped. We always pass a fresh root, so
  skipping is correct.

**What to do when unblocked**:

1. File an issue at `emberjs/ember.js` proposing the renderer accept a
   `Document.Element` reference (or use a duck-type check like
   `'innerHTML' in into`) instead of reading `globalThis.Element`.
   Tiny mechanical fix in their renderer; helps anyone running Ember
   in non-browser environments (workers, edge, server-side).
2. When the renderer fix lands in an Ember release we support
   (post-6.12 LTS or in a 6.12.x patch), drop
   `installSimpleDomGlobals()` from `src/ember/pageHandler.ts`.
3. The polyfill is also installed defensively inside the server-bundle
   harness (`generateServerHarness` in `compileEmber.ts`); drop that
   too once #1 closes.

**How to spot when it's been fixed**: search for `globalThis.Element`
or `instanceof Element` in `@ember/renderer/index.js` of a new
ember-source release; if absent, run the dryrun without the polyfill
and confirm SSR works.

---

## 4. `@simple-dom/document` doesn't ship a serializer

**Issue**: not a bug — design choice. simple-dom is split into
`document` (data model) and `serializer` (HTML output) packages. Ember
inlines `document` inside `ember-source` because the renderer needs the
data model regardless of consumption mode (browser DOM, FastBoot,
devtools). It doesn't inline the serializer because the browser
doesn't need it (native DOM serializes itself).

**Bandaid**: peer-depend on `@simple-dom/serializer`. Users who use the
Ember adapter install it themselves. Same pattern as `react-dom` being
a peer of `react`.

**Status**: not a true bandaid — this is the right shape. Listed here
because it surprised me during the dryrun. There's no upstream fix to
wait for; the split is intentional and correct.

If simple-dom ever consolidates into one package, we can drop
`@simple-dom/serializer` from peer deps. Probably never happens.

---

## Maintenance protocol

When upstream lands a fix:
1. Run the dryrun from the relevant issue without the bandaid in place.
2. If it passes, follow the "what to do when unblocked" steps for that
   entry.
3. Delete the entry from this file once the bandaid is removed from code.
4. Bump the minimum dep version in `package.json` to the fixed release.

When a NEW bandaid lands:
1. Add a numbered entry here with: what's broken, the upstream issue
   link, the bandaid implementation, and the unblock procedure.
2. Add a `// EMBER_BANDAID #N` comment at the bandaid's call sites so
   `git grep` finds them all when it's time to clean up.

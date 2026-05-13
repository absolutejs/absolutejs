# Ember Adapter — Active Bandaids

Workarounds we ship today because of upstream constraints. Each entry
documents what's blocking us and what to do when the upstream fix lands.

---

## 1. `@ember/*` / `@glimmer/*` / `@simple-dom/*` translation to `ember-source/dist/packages/`

**Original blocker**: [oven-sh/bun#30187](https://github.com/oven-sh/bun/issues/30187) —
**FIXED in 1.3.14** ([oven-sh/bun#30188](https://github.com/oven-sh/bun/pull/30188),
merged 2026-05-04). Verified locally on `1.3.14-canary.1+fe735f8f0`:
`import 'ember-source/@ember/renderer/index.js'` resolves correctly.

**Status**: bandaid **stays**, despite the upstream fix. The fix made
the underlying repro work, but the bandaid was solving a *bigger*
problem than the @-prefix wildcard bug.

**What `ember-source@6.12` actually requires**: third-party packages
we depend on (notably `@glimmer/component@2.1.1`) ship `dist/index.js`
with bare imports like:

```js
import { capabilities, setComponentManager } from '@ember/component';
import { destroy } from '@ember/destroyable';
import { schedule } from '@ember/runloop';
import { setOwner } from '@ember/owner';
```

There's no top-level `@ember/component` (etc.) package in
`node_modules/@ember/` — these names only exist as
`node_modules/ember-source/dist/packages/@ember/<X>/index.js`. So
*something* has to translate the bare `@ember/X` specifier to the
`ember-source` internal path during bundling. That's what the
resolver plugins do.

#30187's fix made `import 'ember-source/@ember/X/index.js'` work as
a bare specifier — but `@glimmer/component`'s code doesn't use that
form, and we can't rewrite third-party node_modules. So the
translation work stays.

**Bandaid (still active)**:

- `src/build/buildEmberVendor.ts` — `createEmberResolverPlugin`
  intercepts `@ember/*`, `@glimmer/*`, `@simple-dom/*` resolutions
  inside the vendor build, routing each to the absolute file path
  under `node_modules/ember-source/dist/packages/<spec>/index.js`.
  Standalone packages (`@glimmer/component`, `@glimmer/tracking`,
  `@glimmer/env`, `@simple-dom/serializer`) pass through to Bun's
  normal resolver.
- `src/build/compileEmber.ts` — `createEmberServerResolverPlugin`
  applies the same translation to the server-side Bun.build pass
  that bundles user pages.

**What this bandaid would actually take to remove**: upstream Ember
would need to ship `@glimmer/component` (and friends) bundled with
`ember-source/@ember/X/index.js`-form imports, OR Bun would need a
top-level alias config (it doesn't have one). Neither is realistic
near-term, so this is the right shape.

**What's still possible cleanup**: post-#30187 we *could* switch the
plugin's `return { path: <absolute> }` to use the bare-with-subpath
form `'ember-source/<spec>/index.js'`. That'd be cosmetic — the
plugin still has to map `@ember/X` to *something*, and the absolute
paths it currently returns are correct. Not worth the churn unless
we touch the file for another reason.

**Action when fixed**: nothing. The original wording of this entry
overestimated what #30187's fix would unlock; corrected here.

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

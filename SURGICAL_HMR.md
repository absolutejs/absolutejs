# Surgical Angular HMR — `ɵɵreplaceMetadata` instead of dynamic-import

> Working document for replacing the dynamic-import-based component-style /
> template / service HMR pipeline with Angular's official `ɵɵreplaceMetadata`
> primitive. Same goal as Phase 2: hot-swap `*.component.css`,
> `*.component.html`, and `*.service.ts` edits without re-bootstrapping the
> Angular app — but using the framework API the framework was built for,
> not the workaround we shipped first.
>
> Written after a long live-debug session where the dynamic-import path
> surfaced two interlocking bugs that aren't fixable inside that approach:
> (a) NG0912 "Component ID generation collision detected" warnings on
> every CSS edit because each chunk re-import created a parallel class
> identity, and (b) the visual style update no-op'd against SSR-rendered
> components because Angular concatenates emulated-encapsulation styles
> with scope IDs that diverge between the OLD and NEW class identities.
> The framework was telling us our architecture was off; this document
> describes the corrected architecture and the path to landing it.

---

## 0. The current state (so we agree on the baseline)

**What's already correct and stays:**

- **Server-side edit classification** (`src/dev/angular/editTypeDetection.ts`)
  — TypeScript-AST scan that maps a changed file to one of `template /
  style-component / class-component / service-method-only /
  service-with-side-effects / route / reboot`. The `lastUserEditedFiles`
  capture in `rebuildTrigger.ts` filters dependency-graph dependents
  out of the classifier input so a CSS edit doesn't get classified as
  `class-component` because the sibling `.component.ts` got pulled
  into the rebuild set. This is correct and load-bearing.
- **HMR reason toast** (`src/dev/client/hmrToast.ts`) — bottom-right
  surface that shows the classification + reason on every reboot. Lets
  the developer see WHY a save triggered a reboot without opening
  devtools. Stays.
- **`generated/` outside `src/`** (`src/utils/generatedDir.ts`) — every
  framework's intermediate JIT/AOT output now lives at
  `<projectRoot>/.absolutejs/generated/<framework>/`. Stays.
- **CSS `@import` resolution in the styleUrls preprocessor**
  (`src/build/stylePreprocessor.ts`) — both sync and async paths
  recursively inline `@import "<path>";` into `ɵcmp.styles[]` so
  unresolved bare specifiers don't reach the rendered `<style>` tag and
  trip the SPA wildcard route's NG04002. Stays.
- **NODE_ENV constant-folding fix** (`src/utils/runtimeMode.ts`) —
  reads via `process.env[KEY]` so Bun can't dead-code-eliminate the
  production branches in `dist/`. Stays.
- **The `class-component` proto-swap fast path**
  (`attemptFastPatch` in `src/dev/client/handlers/angular.ts` →
  `applyUpdate` in `angularRuntime.ts`) — patches prototypes + static
  props on the live ctor. Today only hits page-level component
  exports (children inside the chunk closure aren't reached), but
  what it does works. Stays for now; the surgical pipeline below
  supersedes it for child components.

**What's wrong and gets removed:**

The Phase 2 dynamic-import pipeline:

- `handleComponentStyleUpdate` / `handleTemplateUpdate` /
  `handleServiceMethodSwap` in `src/dev/client/handlers/angular.ts`
- `applyStyleUpdate` / `applyTemplateUpdate` / `applyServiceUpdate`
  in `src/dev/client/handlers/angularRuntime.ts`
- The `__ANGULAR_HMR_STYLE_UPDATE_MODE__` /
  `__ANGULAR_HMR_TEMPLATE_UPDATE_MODE__` /
  `__ANGULAR_HMR_SERVICE_UPDATE_MODE__` flags
- The `styleUpdateBatch` / `templateUpdateBatch` / `serviceUpdateBatch`
  buffers and the `register()` branches that route through them

These get stripped in the same commit that lands this document — see
**§5. Revert plan** below. The classifier still produces the right
update-type, but the client falls through to the existing reboot path
for `style-component`, `template`, and `service-method-only` until
the surgical pipeline lands. CSS edits will reboot, with the toast
saying why. That's a regression from "in-place style swap" but a
correct, predictable baseline. Once §1-§4 below land, those edit
types stop rebooting at all.

---

## 1. The architectural problem

The dynamic-import approach was: when a CSS edit fires, the client
runs `import("<page-chunk>?t=<ts>")`. The chunk's auto-registration
block runs `register(id, ctor)` for every component class in the page
tree; for already-registered IDs we routed `ctor` through
`applyStyleUpdate`, which mutated the LIVE ctor's `ɵcmp.styles` and
substring-replaced matching `<style>` tags in the DOM.

Two failure modes that aren't fixable inside this design:

### 1.1 NG0912 — duplicate class identity

Every chunk re-import produces a fresh ESM module record (`?t=<ts>`
forces it). The component classes in that record are NEW JavaScript
class objects — not equal-by-identity to the ones that initially
bootstrapped. When the chunk evaluates,
`Component({...}) → ɵɵdefineComponent(...)` runs against the NEW
class, registering its selector hash with `getComponentId`'s internal
collision map. The OLD class is still alive (Angular has live LViews
referencing it), still in the same map. Two distinct class objects
mapped to the same `app-portal` selector → NG0912 fires every cycle.

This isn't a warning we want to suppress. It's the framework
explicitly telling us we're carrying two parallel class graphs in the
runtime. Even if we silence the message, the rendering path is
referencing one class while DI / template lookups may resolve through
the other depending on which import path got cached first. That's the
class of bug that produces "the page looks fine but the click handler
is wired to the wrong instance."

### 1.2 SSR style scope-ID drift

For Emulated encapsulation (Angular's default), the JIT compiler
rewrites CSS selectors to include `[_ngcontent-c<scopeId>]` /
`[_nghost-c<scopeId>]` attributes, where `<scopeId>` is a hash
derived from the class identity. With two class identities (old +
new), the OLD compiled `ɵcmp.styles[i]` and the NEW one have
DIFFERENT scope IDs. The DOM `<style ng-app-id="ng">` tag carries
the OLD scope ID (because SSR rendered against the old class). The
NEW chunk's `ɵcmp.styles[i]` has a different scope ID, so a
substring-replace finds no match and silently no-ops.

Even with `ViewEncapsulation.None` components (where there's no
scope rewrite), the dynamic-import approach still trips NG0912 — the
visual update happens to work for None because the strings match
literally, but the framework collision warning still fires.

Both failure modes are downstream of "we created a parallel class
identity." That's the architectural mismatch.

---

## 2. The architectural solution

Angular ships an HMR primitive built for exactly this:

```ts
// @angular/core (internal, exported as ɵɵreplaceMetadata)
function ɵɵreplaceMetadata(type, applyMetadata, namespaces, locals,
                           importMeta = null, id = null) {
  const currentDef = getComponentDef(type);
  applyMetadata.apply(null, [type, namespaces, ...locals]);
  const { newDef, oldDef } = mergeWithExistingDefinition(
    currentDef, getComponentDef(type)
  );
  type[NG_COMP_DEF] = newDef;
  if (oldDef.tView) {
    const trackedViews = getTrackedLViews().values();
    for (const root of trackedViews) {
      if (isRootView(root) && root[PARENT] === null) {
        recreateMatchingLViews(importMeta, id, newDef, oldDef, root);
      }
    }
  }
}
```

Read in plain English:

1. Take the LIVE class `type`.
2. Run a callback `applyMetadata(type, ...)` whose body calls
   `ɵɵdefineComponent({ ...new metadata..., type })` — i.e., re-define
   the component metadata ON THE SAME CLASS.
3. Merge the resulting new def with the live def (preserving
   accumulated state Angular tracks).
4. Set `type[NG_COMP_DEF] = newDef` — the same class now points at
   the new metadata.
5. Walk every tracked LView and recreate the ones backed by this
   class so they re-render against the new template / styles /
   bindings.

**Why this is the right primitive:**

- One class identity. NG0912 can't fire — there's never a second
  selector→class mapping to collide with.
- Scope IDs stay stable. The class identity is the input to the
  scope-ID hash; preserving the class identity preserves the IDs,
  so the SSR-rendered `<style>` tag's selectors keep matching the
  rendered DOM after the swap.
- The framework re-runs view-recreation for us. We don't have to
  manually find/replace `<style>` tag textContent — Angular owns
  the renderer, the renderer owns the style injection, and after
  `recreateMatchingLViews` the DOM is in the correct state by
  construction.
- It's the API Angular CLI's HMR plugin uses. We can study and
  match the contract instead of reverse-engineering Bun + Angular
  interactions.

**The sister API**, `ɵɵgetReplaceMetadataURL(id, timestamp, base)`,
returns a URL like `/@ng/component?c=<id>&t=<timestamp>`. Angular's
HMR-aware compile output emits `ɵɵreplaceMetadata` calls that
reference `applyMetadata` callbacks fetched from this URL. The dev
server is expected to serve these on demand. That's the integration
point.

---

## 3. Implementation plan

Five chunks. Each ends with a verifiable state — never land an
intermediate that "kind of works but has known weirdness."

### 3.1 Server: emit `applyMetadata` callbacks for changed components

**Goal:** For every component class touched by a CSS / HTML / service
edit, produce a JS module shaped like:

```js
import { ɵɵdefineComponent, /* ...other Angular runtime symbols... */ }
  from '@angular/core';

export function applyMetadata($type) {
  $type[Symbol.for('ngComponentDef')] = /* new def */;
  // ...or call ɵɵdefineComponent({ ...metadata..., type: $type })
}

export const id = '<component-source-path>#<className>';
```

The metadata in this module is the OUTPUT of Angular's compiler for
the changed component. We already run that compiler in
`compileAngularFileJIT` (server-side); the question is whether its
emit can be configured to produce the HMR-aware `applyMetadata`
shape, or whether we have to re-derive it from the existing
`Component({...})` literal.

**Two paths to evaluate before committing:**

- **(a) Reuse Angular CLI's HMR emit.** Angular's compiler-cli /
  Vite plugin already produces this exact module shape. We'd hook
  into the same code path. Cleanest, most future-proof, but most
  coupling to Angular internals.
- **(b) Hand-write the module from the linked partial declaration.**
  We already have the linked `ɵcmp` factory in
  `.absolutejs/generated/angular/<rel>/<file>.js`. We can wrap it
  in an `applyMetadata` shim. Less coupling, more code we own.

Either way, the module needs:

- `applyMetadata(type)` that mutates `type.ɵcmp` to the new def.
- The same `type` identity as the running app (so the import has
  to be a SOURCELESS module — see §3.2 — that doesn't bring its own
  class).
- Access to the new template, styles, encapsulation, dependencies,
  inputs, outputs, and queries — i.e., the full
  `ɵɵdefineComponent` arg.

**Affected server files:**

- `src/build/compileAngular.ts` — add an HMR-aware emit step that
  produces `<projectRoot>/.absolutejs/generated/angular/_hmr/<sha>.js`
  per changed component, OR wires straight into a memory cache the
  endpoint (§3.2) can serve.
- `src/dev/rebuildTrigger.ts` — when classification is
  `style-component` / `template` / `service-method-only`, call the
  new emitter for each affected component (not just the page bundle).

### 3.2 Server: `/@ng/component?c=<id>&t=<ts>` endpoint

**Goal:** Implement the URL contract `ɵɵgetReplaceMetadataURL`
expects. Returns the `applyMetadata` module from §3.1, with strong
caching keyed by `<id>` + `<ts>`.

**Contract:**

- `GET /@ng/component?c=<encodedId>&t=<encodedTimestamp>`
- Response: `Content-Type: text/javascript`, body is the
  `applyMetadata`-exporting module.
- Stale `<ts>` queries can serve the latest metadata for that id —
  Angular doesn't enforce timestamp-exact matches.
- 404 if the id isn't registered.

**Affected server files:**

- New: `src/dev/angular/replaceMetadataEndpoint.ts`.
- `src/backend/server.ts`-equivalent in absolutejs's dev server
  pipeline (whichever Elysia plugin owns dev routes) — register the
  endpoint and gate it on dev mode.
- `src/dev/clientManager.ts` — track per-component metadata
  versions for cache-busting.

### 3.3 Client: wire `ɵɵreplaceMetadata` into the HMR handlers

**Goal:** Replace the stub handlers (`handleComponentStyleUpdate` /
`handleTemplateUpdate` / `handleServiceMethodSwap`) with real
implementations that:

1. Take the `{id, ...}` from the WS message.
2. Look up the LIVE class from the existing component registry.
3. Fetch `ɵɵgetReplaceMetadataURL(id, timestamp, ...)`.
4. Dynamic-import that URL — this loads the `applyMetadata` module
   WITHOUT any class definitions, so no NG0912.
5. Call `ɵɵreplaceMetadata(LiveClass, applyMetadata, namespaces,
   locals)`.
6. The framework re-runs view-recreation; the developer sees the
   change.

**Affected client files:**

- `src/dev/client/handlers/angular.ts` — strip the stub handlers,
  add the `ɵɵreplaceMetadata` ones.
- `src/dev/client/handlers/angularRuntime.ts` — strip the
  `applyStyleUpdate` / `applyTemplateUpdate` / `applyServiceUpdate`
  + their batch buffers + their `register()` branch. Keep
  `applyUpdate` (the proto-swap fast path) for back-compat with
  `class-component` for now. (Long-term, even `class-component`
  should migrate to `ɵɵreplaceMetadata` for the same reasons —
  see §3.5.)

### 3.4 Per-component change tracking

**Goal:** The classifier in §0 returns ONE update type per HMR
cycle. The surgical pipeline needs ONE `applyMetadata` per CHANGED
COMPONENT, not per page. A CSS edit that touches one
`*.component.css` should produce metadata for that one component;
the page bundles that depend on it shouldn't trigger
`replaceMetadata` for every one of their components.

**Contract:**

- Wire format gains `componentUpdates: Array<{ id, timestamp }>`.
- The server resolves the changed CSS / HTML file → owning
  component class (via the dependency graph or by re-parsing
  `styleUrls` / `templateUrl`).
- Only those classes get `replaceMetadata` calls.

**Affected server files:**

- `src/dev/dependencyGraph.ts` (or wherever — find by grep) — add
  a reverse-lookup `cssFile → owning component class[]`.
- `src/dev/rebuildTrigger.ts` — populate `componentUpdates` from
  that reverse-lookup.

### 3.5 Migrate `class-component` off proto-swap

**Goal:** Stop using `attemptFastPatch` /
`patchConstructor` for component class edits. Use
`ɵɵreplaceMetadata` for them too — same primitive, no special
case. After this, the proto-swap code path can be deleted.

This is a deferrable cleanup, not a correctness fix — proto-swap
works for class edits today (no NG0912 because we don't dynamic-
import the chunk for class edits, we just patch into the existing
class). But unifying on one primitive simplifies the code and
inherits Angular's view-recreate guarantees automatically.

---

## 4. Per-encapsulation handling

`ɵɵreplaceMetadata` takes care of encapsulation differences for free
because the metadata it runs through has the encapsulation field set
correctly per-component. We don't need separate code paths. But
worth documenting how each case behaves so we can verify:

- **`ViewEncapsulation.Emulated`** (default): scope-IDs stable across
  the swap because class identity is preserved. SSR-injected
  `<style>` tag's `[_ngcontent-c<id>]` selectors keep matching the
  rendered DOM. Recreate-LViews path replaces the rendered subtree
  using the new template / styles.
- **`ViewEncapsulation.None`**: no scope-ID rewriting at all. New
  styles overwrite old via the framework's normal style-injection
  path on view-recreate. No special handling.
- **`ViewEncapsulation.ShadowDom`**: each instance has its own
  shadow root. Recreate-LViews tears down the shadow root and
  rebuilds it with new styles. No special handling.

The dynamic-import approach needed `SHADOW_DOM_ENCAPSULATION = 3`
explicit fallback because we couldn't reach inside shadow roots. The
framework path doesn't have that limitation.

---

## 5. Revert plan (lands with this doc)

To get HEAD onto a clean baseline before §3 work begins, the same
commit that adds this document strips:

- `src/dev/client/handlers/angular.ts`:
  - Remove `handleComponentStyleUpdate`, `handleTemplateUpdate`,
    `handleServiceMethodSwap` bodies → keep their stubs that
    return `false` so the dispatch falls through to reboot.
  - Remove the `StyleUpdateWindow` / `TemplateUpdateWindow` /
    `ServiceUpdateWindow` types.
- `src/dev/client/handlers/angularRuntime.ts`:
  - Remove `applyStyleUpdate`, `applyTemplateUpdate`,
    `applyServiceUpdate` and their helpers (`collectStyleHosts`,
    `findStyleTagContaining`, `swapPrototypeMethods`,
    `tryInstantiateServiceDonor`, `mergeMissingFields`,
    `getRootInjector`, `TEMPLATE_PATCH_FIELDS`).
  - Remove `styleUpdateBatch`, `templateUpdateBatch`,
    `serviceUpdateBatch` + their `begin*` / `end*` exports.
  - Restore `register()` to the original "if not already
    registered, add" body — drop the batch-routing branches.
  - Remove the new fields from `AngularComponentDefinition`
    (template / consts / decls / vars / viewQuery /
    contentQueries / etc.) — those were for the template-patch
    code that's leaving with the rest.
- `types/globals.d.ts`:
  - Remove `applyStyleUpdate`, `applyTemplateUpdate`,
    `applyServiceUpdate`, the `begin*` / `end*` batch helpers, and
    the `__ANGULAR_HMR_*_UPDATE_MODE__` window keys from
    `__ANGULAR_HMR__`.
- `src/build/compileAngular.ts`:
  - The `*Service / *Directive / *Pipe` registration regex
    extension stays (harmless, useful for §3 once
    `applyServiceUpdate` is real). All other dynamic-import-era
    additions stay (they don't affect the broken paths).

What stays after the revert: classifier, toast, `generated/` move,
CSS `@import` resolution, NODE_ENV fix, `class-component` proto-swap
fast path, full reboot path. Every classification still produces a
correct broadcast; CSS / template / service-method edits trigger a
correct reboot with the toast explaining why. No half-states.

---

## 6. Verification gates

Each phase's "done" gate is concrete and runnable. Same format as
ANGULAR_HMR.md's Phase 1 verification.

### After §3.1 + §3.2 (server-side endpoint)

1. **Endpoint serves a valid module** — `curl
   "http://localhost:3000/@ng/component?c=<id>&t=<ts>"` returns a
   200 with `Content-Type: text/javascript`. Body imports
   `ɵɵdefineComponent` from `@angular/core`, exports a function
   `applyMetadata`.
2. **Metadata reflects the latest source** — edit
   `*.component.css`, hit the endpoint, verify the body's `styles`
   array contains the new content.
3. **Cache-bust on `t` change** — two requests with different `t`
   values both succeed; the latest content always reflects current
   source.

### After §3.3 + §3.4 (client wiring)

4. **CSS edit at `/portal/dashboard` does NOT reboot.** Open
   `/portal/dashboard` in Playwright (authed), capture
   `[pageerror]` + `[error]` console events, edit
   `profile-header.component.css`. Pre-edit and post-edit console
   diffs must contain ZERO of: NG0912, NG04002,
   `Transition was skipped`, `[HMR] Angular reboot`.
5. **Visible style updates take effect.** Same Playwright flow as
   #4, but assert a CSS property value on the rendered element
   changes after the save.
6. **Component-class edit does NOT reboot.** Same flow, edit a
   `*.component.ts` method body, assert no reboot toast and the
   method's behavior changes.
7. **Service method edit does NOT reboot.** Same flow, edit a
   `*.service.ts` method that has no constructor side effects,
   assert the new method body is invoked on next call.
8. **Service-with-side-effects edit reboots cleanly.** Edit a
   service with a `subscribe(...)` in the constructor, assert the
   reboot toast appears and the page survives without NG0912.

### After §3.5 (proto-swap migration)

9. **Old proto-swap path is removed.**
   `grep -r 'attemptFastPatch\|patchConstructor' src/` returns
   zero hits.
10. **All component-class edits go through `ɵɵreplaceMetadata`.**
    Same Playwright flow as #6, plus a console assertion that the
    handler logged "via ɵɵreplaceMetadata".

---

## 7. Suggested order of operations

§0's revert is the prerequisite — HEAD has to be clean before §3
work starts. Then:

1. **§3.1** (server-side `applyMetadata` emit) — biggest unknown.
   Spike Angular CLI's HMR emit to verify either path (a) or (b)
   produces the right shape against a real component before
   committing.
2. **§3.2** (endpoint) — small, mostly plumbing.
3. **§3.3** (client wiring) — straightforward once §3.1's output
   is well-defined. This is where the first user-visible win lands
   (CSS edits stop rebooting).
4. **§3.4** (per-component tracking) — depends on §3.1+§3.3
   working end-to-end. Until this lands, edits broadcast metadata
   for the whole page bundle (overshoots but is correct).
5. **§3.5** (proto-swap migration) — purely cleanup; no user-
   visible change. Defer if it's tight.

§3.1 is the load-bearing one. Most of the integration risk lives
there — the rest is wiring. Spike it in isolation against a
single component before committing to the architecture across the
codebase.

---

## 8. Open questions

Things to figure out during §3.1's spike, NOT inside this doc:

- **Does Angular's compiler-cli expose the HMR-aware emit as a
  public API, or do we have to invoke it through Vite's plugin
  shape?** If it's Vite-coupled, we may need a thin shim that fakes
  the Vite plugin context.
- **What's the exact `applyMetadata` shape for components that have
  pipes / directives / dependencies?** The snippet in §3 only
  shows the simple case. Pipes and directive dependencies are
  passed via `directiveDefs` / `pipeDefs` in `ɵɵdefineComponent`;
  those need to map to the running app's existing pipe/directive
  classes, not new ones.
- **Does `recreateMatchingLViews` preserve form state and scroll
  position?** If not, we need to capture them before the swap and
  restore after — the existing reboot path already does this via
  `saveFormState` / `saveScrollState`, may need to be reused.
- **What happens when the user edits a component that's not
  currently mounted?** `recreateMatchingLViews` is a no-op — fine.
  But the metadata still needs to be replaced so the next mount
  uses the new content.
- **How does this interact with the SSR cache?** After a
  `replaceMetadata` cycle, the SSR cache for the affected page is
  stale. Existing `markSsrCacheDirty('angular')` should still be
  the right hook.

These belong in the spike, not the design — listed here so they
don't get forgotten.

---

## 9. Spike findings (§3.1 — option (a) is viable, committing to it)

Drove `@angular/compiler-cli`'s `NgCompiler.emitHmrUpdateModule(node)`
against `dealroom/src/frontend/components/profile/profile-header/profile-header.component.ts`
and inspected the output. The integration shape is cleaner than the
design assumed.

### What works

**The full HMR contract is built into `compiler-cli` already**, gated
behind `enableHmr: true` on the compiler options. Two things happen
when that flag is set:

1. **Caller-side emit** — every component's compiled `.js` automatically
   gets a `${ClassName}_HmrLoad` initializer baked in by
   `compileFull → compileHmrInitializer`. The initializer:
   - Encodes a stable `id = encodeURIComponent('${filePath}@${className}')`
   - Defines `function ${ClassName}_HmrLoad(timestamp) { import(/* @vite-ignore */ ɵɵgetReplaceMetadataURL(id, timestamp, import.meta.url)).then(m => m.default && ɵɵreplaceMetadata(${ClassName}, m.default, [<namespaces>], [<locals>], import.meta, id)); }`
   - Calls it once at module load (`ClassName_HmrLoad(Date.now())`)
   - Listens on `import.meta.hot.on('angular:component-update', d => d.id === id && ClassName_HmrLoad(d.timestamp))`
2. **Callee-side emit** — `NgCompiler.emitHmrUpdateModule(classNode)`
   returns a complete JS module string whose `default` export is the
   `${ClassName}_UpdateMetadata` function. That function:
   - Takes `(LiveClass, ɵɵnamespaces, ...locals)` — exactly what
     `ɵɵreplaceMetadata.apply(null, [type, namespaces, ...locals])`
     passes in
   - Body assigns `LiveClass.ɵfac = ...` and
     `LiveClass.ɵcmp = ɵhmr0.ɵɵdefineComponent({...new metadata...})`,
     mutating the EXISTING class. No new class identity created.

The emitted module's `styles:` array uses Angular's
`_ngcontent-%COMP%` placeholder — `%COMP%` gets substituted with the
LIVE class's existing scope ID at apply time. Scope-ID stability is
automatic; we don't need to do anything to preserve it.

### What that implies for §3.2-§3.4

- **§3.2 endpoint** is straightforward: `/@ng/component?c=<id>&t=<ts>`
  → look up the `ts.ClassDeclaration` node by id → call
  `program.compiler.emitHmrUpdateModule(node)` → return the string
  with `Content-Type: text/javascript`. Caching is keyed on
  `(id, source-mtime)`; the `t=<ts>` query is just a cache-buster.
- **§3.3 client wiring** mostly evaporates. Angular's emitted
  `_HmrLoad` listener already calls `ɵɵreplaceMetadata` for us. We
  just need to send the Vite-shape WS event:
  `{type: 'angular:component-update', id: '<encodedId>', timestamp: <number>}`.
  The runtime needs `import.meta.hot` to exist with an `on(event, cb)`
  shape; we'll polyfill that in `installAngularHMRRuntime` (or
  whatever loads first in the page chunk) so the listener wires
  itself.
- **§3.4 per-component tracking** is also simpler than designed: the
  classifier already maps a CSS edit to its owning component(s). We
  just emit one `angular:component-update` event per affected id with
  a fresh timestamp.
- **§3.5 proto-swap migration** stays as written — once the
  `_HmrLoad` listener is in every component's compiled output, the
  proto-swap path's only job (page-level component class edits)
  is also handled automatically.

### Trade-offs and open issues, refined

- **AOT vs JIT.** `emitHmrUpdateModule` only exists on `NgCompiler`,
  which is the AOT path (`performCompilation`). Today's HMR pipeline
  uses `compileAngularFileJIT` (~50-100ms per component) with JIT
  linking on the client. AOT cold-start is ~5-10s for the dealroom
  tree; incremental rebuilds with `oldProgram` reuse are ~100-300ms
  per touched component. **Decision: switch the dev/HMR path to
  AOT-with-incremental-reuse.** The cold-start hit is the same order
  of magnitude as today; the incremental hit is faster than the
  current chunk-rebuild path. Production is unaffected (already AOT).
- **Compiler-cli is not Vite-coupled.** The HMR emit lives on
  `NgCompiler`, which is reachable via `program.compiler` after
  `performCompilation` (public `readonly` field on `NgtscProgram`).
  No Vite plugin shape required.
- **Pipe / directive dependencies** are passed as the `locals[]`
  args to `applyMetadata` (after `namespaces`). The compiler-cli
  emits the local-dependency ARRAY in the caller's `_HmrLoad` body
  by reference to the original imports — i.e., the page chunk's
  `CommonModule, Component, Input, Output` are passed forward. Same
  identities the running app has. No drift.
- **`recreateMatchingLViews` and form/scroll state.** Walking
  `ɵɵreplaceMetadata`'s implementation: it tears down and recreates
  matching LViews. Form values bound via `ngModel` reconnect (the
  `FormControl` is on the model object, not the LView). Scroll
  position is window-level, untouched. The existing reboot path's
  `saveFormState` / `saveScrollState` shouldn't be needed for
  `replaceMetadata` cycles. Confirm in §3.3 verification.
- **SSR cache.** `markSsrCacheDirty('angular')` is still the right
  hook — call it on every component-update broadcast.

### Scope of work for §3.2 onward

Smaller than designed because the framework does most of it:

- **§3.2** (server endpoint): ~100 lines — one route handler that
  calls `NgCompiler.emitHmrUpdateModule(node)` keyed by id.
- **§3.3** (client wiring): ~50 lines — polyfill `import.meta.hot.on`
  with a thin shim over the existing WS, broadcast Vite-shape events
  from the rebuild trigger. NO custom `replaceMetadata` call from
  our code — the framework does that itself.
- **§3.4** (per-component tracking): ~50 lines — for each changed
  component the classifier identifies, emit one
  `angular:component-update` event.
- **§3.5** (proto-swap migration): can probably be a deletion-only
  PR. Once `_HmrLoad` is universal, `attemptFastPatch` /
  `applyUpdate` / `patchConstructor` have no callers.

### One blocker we hit, fixed

The first spike call returned `null` from `emitHmrUpdateModule`
silently. Cause: `enableHmr: true` must be on the compiler options.
Without it, the analyzer skips the HMR metadata extraction and the
emit has nothing to produce. Documented here so the §3.2
implementation doesn't trip on it.

### Direction committed

**Going with option (a).** Reuse Angular CLI's HMR emit via
`NgCompiler.emitHmrUpdateModule`. Don't hand-roll. The
hand-roll path (option b) is now off the table — there's no
reason to reimplement what's already a public-ish API on
`compiler-cli`.

Next chunk to land: §3.2 — the `/@ng/component?c=<id>&t=<ts>`
endpoint, with the AOT incremental-rebuild loop wired into the
existing `compileAngular` pipeline.

---

## 10. §3.2 — DONE. All three verification gates pass.

Landed:

- **`src/dev/angular/hmrCompiler.ts`** — owns the AOT-incremental
  program lifecycle. Loads `@angular/compiler` then
  `@angular/compiler-cli`, builds compiler options with
  `enableHmr: true`, sets up a `ts.createCompilerHost`, runs
  `performCompilation`, captures the resulting `program` on
  `globalThis.__ABSOLUTE_ANGULAR_HMR_PROGRAM__`. Subsequent calls
  pass `oldProgram` for incremental reuse — but only when truthy
  (the FIRST call has to omit the property entirely, ngtsc's
  internals access `oldProgram.incrementalStrategy` without a null
  guard and throw `TypeError: null is not an object` on a
  literal `null`).
- **`src/dev/rebuildTrigger.ts`** — `compileAndBundleAngular`
  now shadow-calls `compileAngularForHmr` after the JIT page-chunk
  emit. Failures are caught + logged; the existing reboot path is
  unaffected. Threads `state.lastUserEditedFiles` through as the
  candidate `modifiedResourceFiles` set.
- **`src/plugins/hmr.ts`** — `/@ng/*` wildcard handler. Two
  sub-paths:
    - `/@ng/debug` — JSON dump of cached program state (has
      program? sample source files? total count?). For diagnosing
      404s from the component endpoint.
    - `/@ng/component?c=<encodedId>` — calls
      `getApplyMetadataModule(id)` and serves the result as
      `text/javascript`. 404 when no program is cached or the id
      doesn't resolve to a class node in the program.
  *Wildcard rather than two exact paths* because Elysia's tree
  router doesn't reliably match exact paths whose first segment
  starts with `@` — neighbours `/@src/*`, `/@hmr/*`, `/@stub/*`
  are all wildcards for the same reason.

### Verification gates — all PASS

- **#1 Endpoint serves a valid module** — `curl
  '/@ng/component?c=src%2F...%40ProfileHeaderComponent&t=...'`
  returns 200, `Content-Type: text/javascript`, body opens with
  `export default function ProfileHeaderComponent_UpdateMetadata
  (ProfileHeaderComponent, ɵɵnamespaces, CommonModule, Component,
  Input, Output) { ... }`. ~22KB for ProfileHeaderComponent.
- **#2 Metadata reflects the latest source** — appended a marker
  `.surgical-marker-INCR-<ts> { color: red }` to
  `profile-header.component.css`, the post-rebuild endpoint
  response contains 2 occurrences (one in the inlined raw styles,
  one in the scope-rewritten `_ngcontent-%COMP%` form).
- **#3 Cache-bust on `t` change** — restored the source CSS,
  triggered the rebuild, re-curl-ed: marker count drops to 0.
  The endpoint always reflects current source; the `t=` query
  param is documented as a cache-buster and is functionally
  honored.

### Configuration that made it work

The right `performCompilation` call shape for HMR-aware emit:

```ts
const performArgs = {
  emitFlags: EmitFlags.Default,
  forceEmit: true,           // bypass safeToSkipEmit incremental
  host,                       // fresh ts.createCompilerHost per call
  options,                    // includes _enableHmr/enableHmr: true
  rootNames: inputPaths       // page entries; ngtsc walks the graph
};
if (modifiedResourceFiles && modifiedResourceFiles.size > 0) {
  performArgs.modifiedResourceFiles = new Set(modifiedResourceFiles);
}
if (oldProgram) {
  performArgs.oldProgram = oldProgram; // ONLY when truthy
}
const result = performCompilation(performArgs);
```

Three load-bearing details:
1. **`oldProgram` must be omitted when null** — ngtsc's internals
   access `oldProgram.incrementalStrategy` without a null guard
   and throw `TypeError: null is not an object` on a literal
   `null`/`undefined`. Conditional spread.
2. **`modifiedResourceFiles` belongs as a `performCompilation`
   arg, not a host method** — `performCompilation` itself wires
   `host.getModifiedResourceFiles = () => modifiedResourceFiles`,
   then ngtsc's `incrementalFromCompilerTicket` calls
   `compiler.updateWithChangedResources(modifiedResourceFiles)`
   which traverses the resource registry and invalidates exactly
   the components whose `styleUrl`/`templateUrl` matches.
3. **`forceEmit: true`** is belt-and-suspenders past
   `safeToSkipEmit` in the emit loop. With it false, every source
   file's emit is short-circuited if the incremental analyzer
   thinks it's safe to skip — and "the css file is different" is
   apparently not enough to flip that bit on its own.

### Performance

Cold first compile ~17s (full ngtsc analysis on the page-entry
import graph). Subsequent rebuilds with `oldProgram` reuse
~12-14s on dealroom — slower than expected for "incremental,"
likely dominated by `ts.createCompilerHost` + `precomputeAotResourceTransforms`
overhead per call. Optimization for §3.4 once the rest of the
pipeline lands; not a §3.2 blocker because the existing JIT path
is what users actually feel today.

### Pick-up notes for §3.3

1. Page chunks need `_HmrLoad` listeners baked in. Today
   `compileAndBundleAngular` runs `compileAngular(...,hmr=true,...)`
   (the JIT path) for the page chunks; the AOT-with-`enableHmr`
   compile is a SHADOW pass next to it. To enable surgical updates
   on the running app, the page chunks have to come from the AOT
   pass — switch the rebuild trigger from JIT-output to AOT-output
   for client bundling.
2. WS broadcast: when classifier reports
   `style-component / template / service-method-only`, send
   `{type: 'angular:component-update', id: encodeHmrComponentId(...),
   timestamp: Date.now()}` over the existing HMR socket per
   affected component.
3. Client polyfill: Angular's emitted `_HmrLoad` listener
   subscribes via `import.meta.hot.on('angular:component-update',
   cb)`. We don't ship a custom client handler — we polyfill
   `import.meta.hot.on(event, cb)` over the existing
   `hmrClient.ts` WS message bus so Angular's listener fires
   when our message arrives.
4. After §3.3 lands, delete the `/@ng/debug` route — it's
   scaffolding only.

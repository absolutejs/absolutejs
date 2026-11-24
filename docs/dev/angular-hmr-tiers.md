# Angular HMR tiers, and the one that was removed

Angular HMR here has two tiers:

- **Tier 0 — surgical.** `ɵɵreplaceMetadata`, Angular's own HMR
  primitive. Template edits, method bodies, field initializer values.
  State is preserved. Server 20–110 ms, client apply 5–16 ms.
- **Tier 1 — rebootstrap.** The client destroys `ApplicationRef`,
  re-imports the page module and bootstraps again. The page's Angular
  state is lost; the browser session is not.

There used to be a tier between them, and this is the record of why it
is gone — written down because it looked like a working feature for as
long as it existed.

## Tier 1a: per-component remount

For a component-shape change (a new `@Input`, a `changeDetection` or
`encapsulation` switch, new `host` bindings) a full rebootstrap is more
than the edit needs: only one component's shape moved. Tier 1a was
supposed to destroy and recreate just that component at the same DOM
host, via public `createComponent`, splicing the fresh LView back into
its parent's view tree with slot primitives vendored from
`@angular/core`'s private chunks (`src/dev/client/vendor/lview/`).

**It never once ran.** Four defects, each hiding the next.

### 1. It could not find a single component

Angular annotates each host node with `__ngContext__`, but
`attachPatchData` writes **`lView[ID]` — a number** — and registers the
LView internally. Only `getLContext` resolves that number into the
LContext object carrying `.lView` / `.nodeIndex`, caching it back onto
the node. Nothing on a normally-rendered page calls `getLContext`.

The lookup skipped anything that was not already an object, so it
matched nothing. Measured on the example app's `/angular` page in
Chrome: **8 annotated elements, 8 numbers, 0 objects, 0 matches.**

With no matches the remount returned `{ remounted: 0 }` — and the
injected HMR block never read the result. It acked `tier-1a` as a
success. A structural Angular edit therefore showed *nothing*, and HMR
reported that it had applied.

### 2. The old DOM was never removed

`createComponent` renders into the same host element and **appends**,
and tearing down the old LView fires destroy hooks without removing a
node: Angular's DOM removal lives in `destroyLView`, which was
deliberately not vendored. So the old rendering stayed beside the new
one — measured as `"count is 2 count is 0"`, the component twice.

### 3. It would have worked exactly once

`applyMetadata` returns a `_Fresh` class, so after one remount the live
instance is a `_Fresh` instance — while the injected block keeps
passing the original class it captured by closure. The match was
`instance instanceof Class`, which is false from the second edit on.
Measured: edit 1 applied, edit 2 acked `applied in 13ms` and changed
nothing.

### 4. Fixing 1–3 broke Tier 0

With the first three fixed, three consecutive structural edits applied
correctly and sibling state survived. But a `_Fresh` class now lived on
the page, and Tier 0's metadata swap patches the *original* class — so
the next template edit acked success and changed nothing. Verified both
ways: on a fresh page a Tier 0 edit applies; after a remount it does
not.

## Why it was removed rather than finished

Rebootstrap was measured, and it is not the heavy fallback the old
comments implied:

| | |
|---|---|
| Full page reload | **no** (a `window` sentinel survives it) |
| URL | **preserved** |
| Client-side rebuild | **14 ms**, 98 DOM mutation batches |

Tier 1a's client apply was 7–13 ms. **The latency difference is nil.**
The only thing a working Tier 1a would have bought is sibling
components keeping their state — an open dropdown, a scroll position,
an unsaved input elsewhere on the page.

Paying a permanent dependency on Angular's private LView layout, plus
the per-minor re-diff chore, to avoid a 14 ms in-place rebootstrap is
not a good trade. Angular is also actively extending `replaceMetadata`,
the primitive Tier 0 already uses; if it grows to cover field changes,
Tier 1a's whole domain is absorbed by Tier 0.

So the tier is gone, and those edits escalate to rebootstrap.

## What this cost, and the lesson

Four defects survived in shipped code because the integration tests
asserted the **broadcast message**, not the outcome:

```ts
const msg = await waitForAngularTier(c);
expect(msg.type).toBe('angular:component-remount');
```

That passes whether or not the client can act on the message. The
vendored Angular internals were never the thing that broke — no defect
here came from Angular drift. The code failed because nothing ever
exercised it end to end.

An HMR tier is only tested by asserting what the page looks like after
the edit.

## If per-component remount is ever rebuilt

Do not start from the vendored slot constants. Start from
`ng.getComponent`, Angular's own dev-mode global — it goes through
`getLContext`, so it resolves the annotation using Angular's
resolution instead of a guess at its registry, and it is published by
the same dev build such a path would run in. That single call is what
turned defect 1 from unfixable-looking into a one-line fix.

Then budget for defect 4 from the start: Tier 0 and a remount tier must
agree on which class the live views were built from.

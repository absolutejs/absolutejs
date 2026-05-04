# Per-component remount research

Question: can Tier 1 (currently `ApplicationRef.destroy()` +
`bootstrapApplication`) be replaced with a more surgical
"destroy + recreate just the affected component subtree" without
relying on private Angular APIs that shift between minor versions?

Answer: **no, not strictly better than the current behavior, with
public APIs only**. The required mechanism — destroying a child
component without disrupting its parent's view tree, then
recreating it in the same slot — needs LView/LContainer
manipulation that isn't on Angular's public surface. Documenting
this here so we don't re-investigate from scratch later.

## Public APIs that exist

Catalogued from `@angular/core@21.2.6` `core.d.ts`:

| Symbol | What it does | Stable |
|---|---|---|
| `getComponent<T>(el: Element): T \| null` | Find component instance from DOM element | yes (since v14) |
| `getInjector(el: Element \| {}): Injector` | Get injector for element / directive | yes |
| `getContext<T>(el: Element): T \| null` | Get template context (locals) | yes |
| `reflectComponentType(component): ComponentMirror \| null` | Get selector / inputs / outputs / standalone | yes |
| `createComponent(component, opts)` | Create a new ComponentRef at a given host element | yes |
| `viewContainerRef.createComponent(type, opts?)` | Create a component as a child of a VCRef | yes |
| `applicationRef.attachView(viewRef)` | Attach to root change detection | yes |
| `applicationRef.detachView(viewRef)` | Detach from root change detection | yes |
| `applicationRef.components` | Array of root ComponentRefs | yes |
| `componentRef.destroy()` | Destroy a ComponentRef | yes |
| `componentRef.hostView: ViewRef` | View reference | yes |
| `runInInjectionContext(injector, fn)` | Run code with `inject()` available | yes |

## Paths I considered + why each fails

### Path A: Root-component remount

For each root component (in `applicationRef.components`):
- `componentRef.destroy()`
- `createComponent(NewClass, { hostElement, environmentInjector })`

This works with public APIs. **But** for a single-page MPA — which
absolutejs is, and dealroom is — there's exactly one root
component per page. Destroying + recreating that root is identical
to `applicationRef.destroy()` + `bootstrapApplication()`. **No win
over current Tier 1.**

### Path B: Re-render the parent component when a child structurally changes

Walk up from the changed component's host element to its parent
component, then trigger the parent to re-render. Re-render
recreates child views, including the changed component, with the
new code.

**Blocker**: there's no public API for "rerender this component."
The closest is `componentRef.changeDetectorRef.detectChanges()`,
which runs change detection on existing views — it does **not**
destroy + recreate child views. Child component instances stick
around with their old state.

To force destruction of child views, you need
`removeLViewFromLContainer` (private) or direct manipulation of
the parent's LView/LContainer slots (private, layout shifts
between Angular minor versions).

### Path C: Get the parent ViewContainerRef + clear/recreate

Use `getInjector(el)` on the changed component's host element →
inject `ViewContainerRef` from that injector. Call `.clear()` and
then `.createComponent(NewClass)`.

**Blocker**: `inject(ViewContainerRef)` from inside a component
gives that component's *own* VCRef (for inserting children into
itself), not the *parent's* VCRef where this component was
inserted. Child components don't have a public reference to the
parent's view container. The parent created them inside a
`ɵɵdefineComponent.template` function via internal
`createComponentRef`, and that operation doesn't return the VCRef
through any externally-accessible channel.

### Path D: Re-run the new constructor on existing instances

For each live instance:
- `runInInjectionContext(getInjector(el), () => { newConstructor.call(instance); })`

Public APIs all the way. The new constructor body runs on the
existing instance, fresh `inject()` calls return current injector
values, new field initializers replace old field values.

**This *kind of* works but the UX is bad**:
- Lifecycle hooks (`ngOnInit`, `ngAfterViewInit`, ...) don't
  re-fire. Setup logic that runs once on init doesn't repeat.
- User-mutated state (e.g., a counter incremented to `5` via
  clicks) gets reset to its constructor default — but state set
  by *Angular's runtime* (input binding from parent) does NOT
  reset.
- Constructor-set fields refresh, but methods on the prototype
  still need separate patching (which we already do for Tier 0).
- View bindings ALREADY existing in the DOM (event listeners
  bound to old method references) need re-binding — there's no
  public API to refresh those without a full view recreate.

Result: a half-stale/half-fresh instance. Feels worse than a
clean rebootstrap because the user can't tell what state is
current.

### Path E: Hook every component's `ɵfac` factory to maintain a registry

Wrap `Class.ɵfac = (function(orig) { return function(t) { const i = orig(t); registry.add(i); return i; }; })(Class.ɵfac)`
at component-class-load time. The plugin we already use for the
HMR injection block could do this in the same pass. Then on Tier 1,
look up the registry to find live instances + their associated
ComponentRef.

**Blocker**: `ɵfac` returns the instance, not the ComponentRef.
ComponentRef is created higher up by Angular's internal renderer
when it instantiates the component into the parent's LView. We
never see the ComponentRef from outside — `ɵfac` is too low-level.

To get the ComponentRef, we'd hook a level higher (LView
construction), which is private.

## Why Angular CLI doesn't do this either

Angular CLI's HMR integration uses `ɵɵreplaceMetadata` for
component-internal changes (template / styles / dependencies) and
falls back to a full re-bootstrap on structural changes. They
don't do per-component remount either. If they had a public path,
they'd use it.

The Angular team's stated stance (in HMR-related RFC comments
through 2024) is that per-component remount requires runtime
hooks they're not ready to expose publicly.

## Two scenarios where per-component remount would help

For dealroom-shaped apps (single-root, many-leaf-component pages):

1. **A leaf component's constructor changed.** Whole-app rebootstrap
   destroys all sibling state. Per-component remount would only
   destroy the changed leaf. The number of siblings affected is
   high in dealroom (a complex page might have 50 leaf components,
   only one of which is being edited).

2. **A leaf component's `@Component({ providers })` changed.**
   Same shape — only the leaf and its descendants need re-creating.

For root-level changes (page entry, top-level providers), we'd
still rebootstrap the whole thing.

## What would unblock this

A public Angular API that takes a component instance OR
ComponentRef and forces it to be destroyed + re-created with the
current `ɵcmp` def, in-place in its parent's view tree. Roughly:

```ts
// Hypothetical
applicationRef.recreateComponent(componentRef): ComponentRef;
```

Or more granularly:

```ts
ɵViewRef.detach(): void;     // exists, but…
ɵViewRef.attach(viewRef): void; // public attach to a host VCRef? no
```

If Angular ever exposes either of these, this becomes a 50-line
implementation. Until then: **Tier 1 stays whole-app rebootstrap.**

## Pragmatic next move (if dealroom usage shows pain)

Two roads:

1. **Accept the rebootstrap latency**, focus on keeping Tier 1
   frequency low. The fingerprint we shipped already catches
   most structural surgical-incompatible changes; residual
   structural changes are rare in modern Angular code. If
   dealroom feels snappy in practice, the work goes elsewhere.

2. **Vendor private LView access** (Path B/C with internal APIs).
   Locked to a specific Angular minor; refresh on every Angular
   update like we do for the translator. Real implementation
   cost: ~200 lines of Angular runtime-tracking code, plus
   per-Angular-version verification.

Recommendation: option (1) until dealroom-scale usage shows Tier 1
firing too often. The fingerprint signature is granular enough
that most real-world edits are Tier 0.

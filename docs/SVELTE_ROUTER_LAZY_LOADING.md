# Svelte Router — Lazy Loading (Deferred)

Status: **Not implemented**. Documented here so we can pick this up cleanly if a real use case forces our hand.

## Why we deferred it

AbsoluteJS already code-splits at the **page** level — `/svelte/*` ships only `SvelteSpa`'s code, `/react/*` ships only `ReactSpa`'s, etc. Sub-routes inside a single page (the `<Route>` blocks our router exposes) all live in the same page bundle.

For the typical AbsoluteJS app, that page bundle is small and a few sub-routes don't justify per-route splitting. The manual `{#await import(...)}` escape hatch (below) covers the rare "one sub-route is huge" case without requiring router API changes.

## When to revisit

Bring this back to the top of the queue when **any** of these is true:

- A real user reports that one sub-route is dragging their initial bundle (look for >50KB attributable to a single sub-route's content).
- We start shipping `<Route>`-style APIs in user-facing examples that pull in heavy deps (rich-text editors, charting libs, 3D viewers).
- We add a `<RouterOutlet routes={...} />` config-based API (see [SVELTE_ROUTER_PLAN.md](./SVELTE_ROUTER_PLAN.md)) — config-based routes naturally take a `loader` function, so adding lazy loading there is essentially free.

If none of those hit, leave it alone.

## What users do today (the workaround)

A regular `<Route>` snippet can hold a Svelte `{#await}` block around a dynamic `import()`. Bun.build (and any other bundler) sees the `import()` and splits it automatically — no router API needed.

```svelte
<Route path="/svelte/editor">
  {#snippet content()}
    {#await import('./HeavyEditor.svelte')}
      <p>Loading…</p>
    {:then mod}
      <mod.default />
    {:catch err}
      <p>Failed to load: {err.message}</p>
    {/await}
  {/snippet}
</Route>
```

This is documented as the recommended pattern. **No router-side support is needed for it to work.**

## Proposed API (when we do add it)

The natural shape mirrors what every other config-based router does — a `loader` prop that returns a `Promise` resolving to the route's snippet (or default-exported component).

### Surface

```svelte
<!-- Eager (today's API, unchanged) -->
<Route path="/svelte/home">
  {#snippet content()}<HomeView />{/snippet}
</Route>

<!-- Lazy (new) -->
<Route
  path="/svelte/editor"
  loader={() => import('./HeavyEditor.svelte').then((m) => m.default)}
/>

<!-- Lazy with custom loading UI -->
<Route
  path="/svelte/editor"
  loader={() => import('./HeavyEditor.svelte').then((m) => m.default)}
>
  {#snippet pending()}<p>Loading editor…</p>{/snippet}
  {#snippet error(err)}<p>Failed: {err.message}</p>{/snippet}
</Route>
```

### Type shape (`types/svelteRouter.ts`)

Make `RouteProps` a discriminated union:

```ts
type EagerRouteProps<P extends string> = {
  path: P;
  content: Snippet<[ExtractRouteParams<P>]>;
};

type LazyRouteProps<P extends string> = {
  path: P;
  loader: () => Promise<Component<ExtractRouteParams<P>>>;
  pending?: Snippet;
  error?: Snippet<[unknown]>;
};

type RouteProps<P extends string> = EagerRouteProps<P> | LazyRouteProps<P>;
```

The discriminator is presence of `loader` vs `content`. Reject both being set with a runtime error in dev (clear devx > clever overload).

### Implementation sketch

Inside `Route.svelte`:

1. **Detect mode**: branch on `'loader' in $props`.
2. **Eager mode**: unchanged — `{#if isActive}{@render content(match.params)}{/if}`.
3. **Lazy mode**:
   - Maintain a per-Route `Promise` cache (module-level `WeakMap<loader, Promise<Component>>` so the same loader fn isn't re-invoked).
   - When `isActive` flips true and the cache miss, kick off `loader()`.
   - Use `{#await}` inline:
     ```svelte
     {#if isActive && match}
       {#await ensureLoaded(loader)}
         {#if pending}{@render pending()}{:else}<!-- silent -->{/if}
       {:then Comp}
         <Comp {...match.params} />
       {:catch err}
         {#if error}{@render error(err)}{:else}{throw err}{/if}
       {/await}
     {/if}
     ```
4. **Prefetching** (deferred-deferred): hook into the existing `prefetchCache.ts` (hover-prefetch). When `<Link to="/svelte/editor">` is hovered, fire the matching Route's `loader()` to warm the chunk before navigation. Map link targets to loaders via the registry.

### SSR behavior

Two reasonable choices:

- **Block SSR on the loader** — await it during render so SSR HTML is complete. Pro: no hydration flash. Con: TTFB regression for slow loaders. **Recommended for the first version.**
- **Stream / suspense-style** — render `pending` snippet to SSR, hydrate later. Requires absolutejs streaming-slot plumbing. Defer until streaming-slots integration is solid for non-React frameworks.

Start with blocking SSR. The lazy benefit is client bundle size, not server time, so blocking SSR doesn't lose anything important.

### Type-safe `loader` return

`Component<P>` is Svelte 5's component constructor type. Importing `.svelte` files via `import()` returns `{ default: Component<P> }`. Users write `loader: () => import('./X.svelte').then(m => m.default)` to unwrap. We could provide a helper:

```ts
export const lazy = <P>(loader: () => Promise<{ default: Component<P> }>) =>
  () => loader().then((m) => m.default);

// Usage:
<Route path="/x" loader={lazy(() => import('./X.svelte'))} />
```

Worth shipping — it's three lines and saves users from getting the `.then((m) => m.default)` wrong.

## Tests to write when we land it

- Eager mode still works (regression).
- Lazy mode: navigating to a lazy Route resolves the loader, renders the component.
- Loader runs **once** per Route instance even if URL flips active → inactive → active.
- `pending` snippet renders while loader is pending.
- `error` snippet catches loader rejection; if absent, error propagates to the absolutejs error overlay.
- Prefetch: hovering a `<Link>` to a lazy route fires its loader.
- SSR blocks on the loader and emits the resolved component's HTML.
- Two `<Route>`s with the same `loader` reference share the cached promise.

## Compatibility note

This is a strict addition — existing Routes using `content` snippets keep working unchanged. No breaking changes. Safe to ship in a minor version bump.

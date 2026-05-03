# Svelte Router — Scroll Restoration (Deferred)

Status: **Not implemented**. Browsers do *some* scroll restoration on their own (`history.scrollRestoration === 'auto'`), but the result is unreliable for SPA navigation because the page DOM changes between history entries — the browser may try to restore a scroll position to content that no longer exists, or skip restoration entirely.

This doc describes what to ship when we make this an explicit router concern.

## Why we deferred it

For the spa-example use case (sidebar + main panel that swaps content), scroll restoration is barely visible — most sub-routes fit on one screen and the layout stays in place. The browser's default behavior is "good enough" for the demo.

It becomes worth shipping when:

- Users build long-scrolling pages where back/forward should land at the previous scroll position.
- Users hit cases where the browser's auto-restoration lands at the wrong spot (very common with deferred-loaded content that wasn't there at the time the snapshot was taken).
- A user reports it.

## What "good" looks like

Two behaviors users expect:

1. **Forward navigation** (push): scroll to top of the routed area. Or, if the link points at `#anchor`, scroll the anchor into view.
2. **Back/forward navigation** (popstate): restore the scroll position the user was at when they left this entry.

SvelteKit's contract is the same. React Router and Vue Router both expose configurable scroll behavior; that's the right model.

## Proposed API

### Per-Router default

```svelte
<Router scrollBehavior="auto" {url}>
  ...
</Router>
```

`scrollBehavior` values:

- `"auto"` (default if we ship this) — top on push, restore on popstate, anchor on hash.
- `"manual"` — disable router-managed scroll entirely; user handles it.
- `(from, to, savedPosition) => { x: number; y: number } | false | Promise<...>` — full callback; mirrors vue-router's `scrollBehavior`.

### Per-Link override

```svelte
<Link to="/users/42" noScroll>View user</Link>
```

`noScroll` already exists on `<Link>` and `goto()` (per `SVELTE_ROUTER_PLAN.md` §3.4 / §3.5). Wire those flags into the scroll-restoration path so the per-Link option short-circuits the per-Router default.

### Programmatic save/restore

```ts
import { saveScrollPosition } from '@absolutejs/absolute/svelte/router';

// Inside a custom side-effect (e.g. before opening a modal that
// shifts layout):
saveScrollPosition();
```

Optional escape hatch for users who want to snapshot manually. Probably not needed in v1 of this feature.

## Implementation sketch

### Storage

`history.state` is the natural home for the scroll position — it travels with the entry, survives page reloads (in modern browsers), and is per-entry. Schema:

```ts
type RouterHistoryState = {
  // user-provided state via goto({ state: ... }) / pushState
  __user?: unknown;
  // router-owned scroll position
  __absolute?: { scroll?: { x: number; y: number } };
};
```

Wrapping the user's state in `__user` keeps router-managed fields from colliding with whatever the user passed.

### Hooks into existing primitives

In `goto.ts`:
- Before changing the URL, capture the **current** scroll position and write it back to the **outgoing** history entry via `history.replaceState`.
- After applying the new URL, scroll to top (or to anchor if the URL has a `#hash`).

In `Router.svelte`'s `popstate` listener:
- Read `__absolute.scroll` from the new `history.state`.
- If present, `window.scrollTo(...)` after the route render commits.
- "After the route render commits" matters — restoring scroll before the new content is in the DOM scrolls into nothing. The natural hook is `tick()` after `setPage`.

### View Transitions interaction

`document.startViewTransition` snapshots the page mid-transition. Scroll restoration must happen *after* the transition's `finished` promise, otherwise the transition captures the scrolled-to-top state instead of the user's original. Sequence:

1. Capture outgoing scroll position → write to outgoing history state.
2. `startViewTransition(() => updateLocation(...))`.
3. Await `transition.finished`.
4. `await tick()` so the new route's DOM is settled.
5. Apply incoming scroll position (or top, or anchor).

### Hash-anchor scrolling

If the new URL has a `#hash`, look up the element via `document.getElementById(hash)` (or `document.querySelector('[name=...]')` for legacy named anchors) and `scrollIntoView()`. Skip the saved-position restore in that case.

### Hash-mode caveat

In hash mode, `window.location.hash` IS the route — there's no anchor scrolling unless we add a separate convention. Probably acceptable to document "anchor scrolling not supported in hash mode" and call it good. Users on static hosts with anchor needs are an edge of an edge case.

## SSR considerations

Scroll restoration is purely a client concern. SSR emits the page; the client's `Router.svelte` hooks set up the popstate listener on mount and start tracking scroll. **No SSR changes needed.**

## Test plan

- **Unit**: helper that wraps user state and reads back the router-managed scroll position.
- **Integration (in spa-example)**: navigate to a long-scrolling sub-route, scroll to known position, navigate away, navigate back via the back button, assert `window.scrollY` matches.
- **Anchor**: navigate to `/long-page#section-3`, assert `#section-3` is in the viewport.
- **noScroll**: navigate via `<Link to="/x" noScroll>`, assert scroll position unchanged.
- **View Transition + restore**: with `document.startViewTransition` available, assert restoration runs *after* the transition completes.

## Risks

- **Layout shift races.** If the new route's content takes a long time to layout (deferred images, late hydration), scrolling immediately on render lands at the wrong place. Mitigation: wait one `requestAnimationFrame` after `tick()` before scrolling. If users still hit this, document the workaround (`tick()` on user side after their data resolves).
- **Browser auto-restoration fighting us.** Set `history.scrollRestoration = 'manual'` in the outermost `<Router>`'s `onMount` to opt out of the browser's behavior. Restore the original value on cleanup so multiple routers and nested mounts don't trample.
- **Modal / shallow routing.** `pushState` is shallow — it shouldn't reset scroll. Skip the scroll-restoration path entirely when the active `<Route>` doesn't change. Detection: compare incoming and outgoing `match.id`.

## Compatibility

Strict addition. `scrollBehavior` defaults to current behavior (no router-managed scroll) until users opt in. Safe for a minor bump.

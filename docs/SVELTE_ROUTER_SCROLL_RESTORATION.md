# Svelte Router — Scroll Restoration

Status: **Shipped.** While a `<Router>` is mounted it manages the scroll position itself: `history.scrollRestoration` is set to `'manual'` on mount (and the previous value put back on unmount), because the browser's own restoration is unreliable once the DOM changes between entries.

## Behaviour

| Navigation | Scroll |
| --- | --- |
| `<Link>` / `goto()` to a new URL | top of the page |
| … to a URL with a `#hash` (history mode) | the element with that `id` (or `name`) scrolled into view; `#` and `#top` mean the top; a missing target falls back to the top |
| back / forward | the position the user was at when they left that entry; with none saved, the `#hash` target or the top |
| reload, or back/forward into the page from another document | the position saved in the entry |
| `goto(url, { noScroll: true })`, `<Link noScroll>` | unchanged |
| `pushState` / `replaceState` (shallow routing) | unchanged (the position of the entry being left is still saved) |

Focus: unless `keepFocus` is set, a navigation blurs the active element, as before.

## How it works

Every entry the router writes carries bookkeeping next to the application's state:

```ts
history.state = {
	__absoluteRouter: { key: string; index: number; scroll?: { x: number; y: number } },
	user: /* what you passed to goto({ state }) / pushState */
};
```

`page.state` (and the router's `popstate` handling) return `user` unchanged; the wrapper only matters to code that reads `history.state` directly.

- **Saving.** The position of the current entry is tracked in memory on every scroll frame and written into the entry's `history.state` once scrolling settles (150 ms) and before a push. On `pagehide` it is also stored in `sessionStorage`, because some engines drop a `replaceState` made while the page unloads; the next load reads it once.
- **Restoring.** On back/forward the router swaps the route, waits a tick, and scrolls — inside the View Transition callback, so the new snapshot already has the right position. If a lazy route was still loading, it waits for the load (up to 3 s) and applies the position again unless the user has scrolled since. After a reload (or back/forward into the document), the outermost router restores the entry's position once it has mounted.
- **Index.** `index` lets a guard that cancels back/forward undo the traversal with `history.go(-delta)`. Entries the router didn't write (a plain `<a href="#x">` click) are stamped when they are reached.

## Limits

- **Hash mode** uses the hash for the route, so there are no `#anchor` targets: navigations scroll to the top, back/forward restores.
- The router scrolls the window. Scroll positions of inner scroll containers aren't tracked.
- No per-router `scrollBehavior` callback yet; `noScroll` per navigation is the opt-out.

## Tests

`tests/integration/build/svelte-router-browser.test.ts`, in Chromium:

- `scrollRestoration` is `'manual'`; back restores 2000px, forward restores 700px, and a new navigation starts at 0;
- a `<Link to="/app/long#section-5">` lands with `#section-5` at the top of the viewport;
- `goto('/app/long', { noScroll: true })` keeps 1200px;
- a reload right after scrolling to 1500px comes back at 1500px.

`tests/unit/svelte/router/pushState.test.ts` covers the state wrapper (`readUserState`, `readHistoryMeta`).

# Cross-framework navigation plan

Status: Phase 1 implemented (React ↔ Svelte). ROADMAP.md item 1.

Goal: a link from a page built with one framework to a page built with
another navigates without a full page load. The next page is fetched, its
head and body replace the current ones, the old framework app is torn down
and the new one hydrates. Island stores survive, back/forward work, and a
persistent layout can stay mounted (later phase).

## 1. Current state (confirmed at 0.20.0-beta.170)

| Piece | Where | What it does today |
| --- | --- | --- |
| React `<Link>` | `src/react/router/Link.tsx` | Prefetches (`usePrefetch`). Inside `<UniversalRouter>` it `preventDefault`s and calls react-router only when `navigation.matches(href)`; otherwise the click falls through to the browser. |
| React router | `src/react/router/UniversalRouter.tsx` | React Router 7, its own `popstate` handling. No scroll handling. |
| Svelte `<Link>` | `src/svelte/router/Link.svelte` | Always `preventDefault`s a same-origin click and calls the router's `navigate()`, even when no `<Router>` matches (or none is mounted): the URL changes, nothing renders. |
| Svelte router | `src/svelte/router/*` | Guards, lazy routes, View Transitions, scroll restoration (`history.scrollRestoration = 'manual'` while mounted). `history.state` is `{ __absoluteRouter: { key, index, scroll? }, user }`. Outermost `<Router>` listens to `popstate`. |
| Vue | `src/vue/*`, auto router | vue-router's own Link/history. |
| Angular | Angular router | Own history. |
| Prefetch | `src/client/prefetch.ts` | Shared document / route-data / module prefetch cache. `consumePrefetch(url)` hands a prefetched `Response` to a navigation. Route data (`application/vnd.absolute.route+json`) names the page's `framework`, `assets.index`, `assets.css` and props. |
| Island runtime | `src/client/islandRuntime.ts` | `startIslands` hydrates `[data-island]` elements and keeps a `MutationObserver` on `<html>`, so islands in newly inserted markup hydrate on their own (deduped by `data-hydrated` / a WeakSet). No island teardown. |
| Island stores | `src/client/islandStore.ts` | Store instances are per bundle copy; the shared snapshot lives on `globalThis.__ABS_ISLAND_STATE__` and a new instance adopts it. `initializeIslandStores` lets the live snapshot win over server state. Island pages re-seed `window.__ABS_ISLAND_STATE__` from the server in a head `<script>`. |
| Hydration indexes | `src/build/generateReactIndexes.ts`, `compileSvelte.ts`, `compileVue.ts`, `compileAngular.ts` | React hydrates `document` (pages render `<html>`). Svelte mounts into `#absolute-svelte-root`/`body`. All four set `window.__ABSOLUTE_PAGE_READY__` and `window.__ABSOLUTE_PAGE_DISPOSE__` (added for the mobile shell, `src/mobile/client.ts`). HTML/HTMX pages have neither. |
| Bootstraps | page handlers | React: inline `bootstrapScriptContent` (props) + `<script type="module" async src=index>`. Svelte: one inline script that sets props and `import()`s the index. Both carry the request's CSP nonce under `secureHeaders()`. |
| Vendor chunks | `buildReactVendor` etc. | Framework runtimes are shared, unhashed-per-page vendor modules; each client pass (React, non-React, islands) bundles its own copy of `@absolutejs/absolute/client`. |
| HMR client | `src/dev/client` | Keyed on `window.__HMR_FRAMEWORK__` (set by each dev index). Not aware of soft navigations. |

Consequences that shaped the design:

- Each framework bundle has its own copy of the client runtime, so any
  shared navigation state must live on `globalThis` (a `Symbol.for` key),
  exactly like the island store snapshot.
- An ES module evaluates once per document. Coming back to a page whose
  index already ran would be a no-op, so a revisit needs a fresh module URL.
- React owns the whole document (`hydrateRoot(document)`), so the swap
  must leave `<html>`, `<head>` and `<body>` in exactly the server's shape
  before the React index runs.

## 2. Design

### 2.1 Interception

One global layer, `src/client/navigation.ts`, installed by
`enableNavigation()` (idempotent across bundle copies via
`Symbol.for('absolutejs.navigation')` on `globalThis`).

- **Clicks**: a bubble-phase `click` listener on `window`. It runs after
  every framework's delegated handler, so a click a framework router
  handled (`defaultPrevented`) never reaches it. That is the whole
  "framework Links defer to the layer" contract: a router claims the URLs
  it has routes for; everything else is a document navigation, which the
  layer turns into a soft swap. Same-framework navigation that a router
  handles stays with that router.
  - React `<Link>` already falls through for unmatched URLs. No change.
  - Svelte `<Link>` now asks `belongsToDocumentNavigation(to)`: when the
    layer is on, the router is in history mode and no mounted `<Router>`
    matches, it leaves the click alone. The router handle gained
    `matches(url)` for this. Without the layer, behaviour is unchanged.
  - Vue `<Link>` / vue-router and Angular `routerLink`: phase 3 (same
    rule: hand off when the router has no matching route).
- **Skipped** (browser handles it): modifier/middle clicks, `target`
  other than `_self`, `download`, `rel~=external`, cross-origin, a
  same-page `#hash`, `data-absolute-navigation="off"` on the link or an
  ancestor, `shouldIntercept(url) === false`, and any page that cannot be
  torn down (no `__ABSOLUTE_PAGE_DISPOSE__`, e.g. an HTML page).
- **Back/forward**: a capture-phase `popstate` listener (runs before the
  routers' listeners). If the entry the browser landed on belongs to
  another document, it calls `stopImmediatePropagation()` (so the
  current page's router never tries to render a foreign URL) and swaps.
  Entries of the current document are left to its router.
- **Entry ownership**: with the Navigation API, a `Map<entry.key,
  documentId>` filled from `currententrychange` for push/replace (router
  pushes included) and by the layer for its own entries; an unknown entry
  is foreign. Without the Navigation API (history fallback),
  `history.pushState`/`replaceState` are wrapped to merge a
  `__absoluteNavigation: { doc, key }` stamp into object/null states
  (routers keep their own keys beside it); an unstamped entry stays with
  the current page.
- **Programmatic**: `navigateDocument(href, { replace })`.
- **Phase 4**: move interception to the Navigation API `navigate` event
  where available (covers form submissions and `location.assign`), with
  the click/popstate path as the fallback.

### 2.2 Swap

1. `absolute:before-navigate` (cancelable except for traversals).
2. Fetch the target HTML, taking a `<Link>`-prefetched response from
   `consumePrefetch` when there is one. Non-2xx, non-HTML or a
   cross-origin redirect → full navigation. A same-origin redirect uses
   the final URL.
3. Parse with `DOMParser`. Replace every executable `<script>` with a
   comment placeholder (parsed scripts are inert and must never be
   inserted).
4. Load the target's `<link rel=stylesheet>`s first, inert
   (`media="not all"`), and wait for them (5 s cap): no flash of unstyled
   content.
5. Push/replace the history entry (outside the View Transition callback:
   Chrome records the leaving entry's scroll as 0 inside it).
6. In a View Transition when supported (skipped for
   `prefers-reduced-motion` or `viewTransition: false`):
   `__ABSOLUTE_PAGE_DISPOSE__()` (React unmount / Svelte unmount / Vue
   unmount / Angular destroy), clear page-scoped globals
   (`__INITIAL_PROPS__`, `__SSR_DIRTY__`, `__ABS_SVELTE_LAZY_ROUTES__`,
   ...; never `__ABS_ISLAND_STATE__`), sync `<html>` attributes, merge the
   head (elements with the same tag/attributes/text are kept, so shared
   stylesheets and favicons don't reload; others replaced), replace the
   body, enable the new stylesheets, apply scroll.
7. Run the scripts in document order, recreated at their placeholders,
   one at a time (an inline props script must run before the index that
   reads it). A module entry that already ran in this document (or an
   inline `import("…")` of one) gets `?absolute-nav=N`, so the index
   re-runs; its imports (vendor and shared chunks) keep their URLs and are
   not re-evaluated.
8. Wait for the new page's `__ABSOLUTE_PAGE_DISPOSE__` to appear (the
   index registers it after mounting; Svelte's index is `import()`ed by an
   inline script, so this is a short poll) and `__ABSOLUTE_PAGE_READY__`.
9. Re-apply scroll if hydration put the window back at 0, reset focus,
   announce, `absolute:after-navigate`.

JSON envelope alternative (rejected for phase 1): route data carries props,
index and CSS but not the server-rendered body, head tags, streaming slots
or island markup, so the target would client-render (no SSR, layout shift)
and every page feature that lives in HTML would need a JSON twin. The HTML
swap keeps SSR output, works for every framework without per-framework
code, and the CSP problem has a precise answer (2.5).

### 2.3 State

- **Island stores** survive: the swap never touches
  `globalThis.__ABS_ISLAND_STATE__` / `__ABS_ISLAND_STORES__`; the new
  page's store instances adopt the snapshot when they are created. When
  an island page's head script re-seeds `__ABS_ISLAND_STATE__` with
  server state, the layer merges right after each script runs, live
  snapshot winning per store (`initializeIslandStores`' rule).
- **Islands**: islands in the new body hydrate through the existing
  `MutationObserver`; the bootstrap module re-runs on a revisit
  (deduped). Old islands are dropped with the old body but not unmounted
  (phase 2: an island dispose registry in `islandRuntime`).
- **Scroll**: tracked per history entry (rAF-throttled `scroll` listener,
  plus a snapshot just before a push). Push → top or `#hash` target;
  traversal → the saved position. The browser's own restoration is left
  alone (Svelte's router keeps its own).
- **Focus and announcements**: the old focus is gone with the old body;
  `[autofocus]` in the new page is focused, otherwise the active element
  is blurred. An `aria-live="assertive"` `role="status"` region
  (`#absolute-navigation-announcer`, visually hidden via CSSOM so
  `style-src-attr` can't block it) announces `document.title`, falling
  back to the first `<h1>` and then the path.

### 2.4 Persistent layouts (phase 5, design only)

Mark a subtree `data-absolute-persist="<id>"` on both pages. During the
head/body swap, a persisted element present in both bodies is moved (not
re-created) from the old body into the new one, replacing its twin, so
its framework app (an island or a separately mounted app) keeps its state.
Requirements: the persisted subtree must be mounted as its own root (an
island or `createIsland` root), never part of the page app, because the
page app is unmounted; React's document hydration must skip it (render it
as an island placeholder with `suppressHydrationWarning` and identical
markup), and the islands runtime must not re-hydrate a moved island
(`data-hydrated` already prevents it). Layout routes (`layout.tsx`
conventions) would emit the marker automatically.

### 2.5 Fallbacks

- Any thrown error after the history entry was written → `location.reload()`
  (lands on the new URL); before it → `location.assign/replace(url)`.
- Opted-out links, non-HTML/non-2xx responses, cross-origin redirects,
  pages with no teardown hook → the browser's own navigation.
- JS off: plain `<a href>` everywhere, so every link still works.
- A newer navigation aborts the in-flight fetch; the older one resolves
  `'superseded'`.

### 2.6 CSP

`secureHeaders()` sends `script-src 'self' 'strict-dynamic' 'nonce-N'` and
`style-src 'self' 'nonce-N'` with a fresh N per response. A fetched page's
inline scripts and styles carry ITS response's nonce N2, which the current
document (policy N1, fixed for the document's life) rejects. Also,
`DOMParser` documents inherit the current policy, so merely parsing a
`<style nonce=N2>` is reported as a violation.

Rule: **what the browser would have run on a full load runs here, nothing
more.**

1. Read N2 from the response's `Content-Security-Policy` header.
2. Before parsing, rewrite `nonce="N2"` attributes to the current nonce N1
   (read once at `enableNavigation()` through the `nonce` property, which
   the browser keeps while hiding the attribute). Elements without N2 (for
   example markup injected through `dangerouslySetInnerHTML`) get nothing.
3. Scripts are recreated with `setAttribute('nonce', N1)` only if they
   carried it, so they also stay discoverable as nonce carriers for code
   that reads the page nonce later (`script[nonce]`).
4. No CSP header on the response → everything is trusted (as a full load
   would run it). A CSP without a nonce → nothing gets one; the current
   policy decides.
5. External module scripts and `import()` are covered by `'strict-dynamic'`
   (the layer runs from a nonced script) and by the nonce.

Verified: zero `securitypolicyviolation` events across React → Svelte →
React under `secureHeaders()`.

## 3. Phase 1 API (shipped)

```ts
import {
	enableNavigation,
	navigateDocument,
	disableNavigation,
	isNavigationEnabled
} from '@absolutejs/absolute/client/navigation';

enableNavigation({
	shouldIntercept: (url) => !url.pathname.startsWith('/admin'),
	viewTransition: true // default
});
await navigateDocument('/svelte'); // 'swapped' | 'reloaded' | 'superseded' | 'cancelled'
window.addEventListener('absolute:before-navigate', (event) => event.preventDefault());
window.addEventListener('absolute:after-navigate', (event) => console.log(event.detail.url));
```

Call `enableNavigation()` on every participating page (a React `useEffect`,
a Svelte `onMount`); the first call installs, later ones are no-ops, and
the layer outlives the page that installed it. Do not tie
`disableNavigation()` to a component's unmount: the page is unmounted on
every navigation.

## 4. Phases and exit criteria

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 1 (done) | Layer + React ↔ Svelte via `<Link>`, styles, island store, back/forward + scroll, history fallback, CSP | Playwright (prod build): React→Svelte→React with no document request; target hydrates and is interactive; stylesheets swapped, Svelte scoped CSS applied; store value carried both ways; back/forward and scroll restore; same with the Navigation API removed; zero CSP violations under `secureHeaders()`; opt-out link does a full load. Packed-tarball e2e in prod and dev. |
| 2 | Teardown completeness | Island dispose registry (islands unmounted with the old body); `__ABSOLUTE_PAGE_DISPOSE__` for HTML/HTMX pages (no-op) so they can participate; prefetch cache on `globalThis` so a Svelte `<Link>` hover warms the React-installed layer; dev HMR follows the swapped page (`__HMR_FRAMEWORK__`, per-page manifest); a framework-supplied index boot function instead of `?absolute-nav=` re-imports. Exit: React ↔ Svelte ↔ HTML ↔ HTMX with islands, no leaked roots (heap snapshot), HMR edit after a soft navigation applies. |
| 3 | Vue + Angular | Vue `<Link>` / vue-router and Angular `routerLink` hand off unmatched URLs; Angular zone and platform teardown verified. Exit: the Phase 1 suite for every framework pair (5×5 matrix in Playwright, prod + dev). |
| 4 | Navigation API interception | `navigate` event `intercept()` where supported (forms, `location.assign`, programmatic), click/popstate fallback elsewhere; `config.navigation: true` injects `enableNavigation()` into every hydration index. Exit: suite passes in Chromium (Navigation API) and WebKit/Firefox (fallback). |
| 5 | Persistent layouts | `data-absolute-persist` (2.4) plus layout-route emission. Exit: a React navbar island keeps state (input value, open menu) across React → Svelte → Vue. |

## 5. Known limitations (phase 1)

- Islands of the old page are not unmounted (memory only).
- Only the layer's own bundle copy sees `<Link>` prefetches from its
  framework; a document prefetched by another framework's `<Link>` is
  still in the HTTP cache, so the fetch revalidates.
- A revisited page's index module is downloaded again under a new query
  string (small; vendor chunks are not).
- Dev mode: the HMR client keeps listening, but HMR after a soft
  navigation is not verified (phase 2).
- `history.state` gains an `__absoluteNavigation` key only in browsers
  without the Navigation API.

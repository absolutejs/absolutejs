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
| React `<Link>` | `src/react/router/Link.tsx` | Prefetches (`usePrefetch`). Inside `<UniversalRouter>` it `preventDefault`s and calls react-router only when `navigation.matches(href)`; otherwise the click falls through to the browser. Import it from `@absolutejs/absolute/react/components` in a project without react-router: the `react/router` entry also exports `<UniversalRouter>`, so it needs react-router (a build without it fails with that advice). |
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
- **Forms, `location.assign()` and programmatic navigation**: a
  `navigate`-event listener where the Navigation API exists, added in
  0.20.0-beta.249 — see 4h for what it takes and, more importantly, what
  it must not take (a router's own `pushState` fires the same event).
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

### 2.4 Persistent layouts (phase 5, design only — see 4i)

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

**A prototype has since been built and measured — 4i supersedes the
paragraph above wherever they disagree.** Two of the assumptions here do
not survive a browser: `data-hydrated` does not protect a moved island on
a Svelte page, because the page's island slot re-creates the markup rather
than re-hydrating it, and the disposer registry unmounts a persisted
subtree for being briefly detached. 4i also records the live double-mount
defect that has to be fixed first.

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
| 2 | Teardown completeness | ~~Island dispose registry (islands unmounted with the old body)~~ **done, 0.20.0-beta.234**; ~~`__ABSOLUTE_PAGE_DISPOSE__` for HTML/HTMX pages (no-op) so they can participate~~ **done, 0.20.0-beta.235**; ~~prefetch cache on `globalThis` so a Svelte `<Link>` hover warms the React-installed layer~~ **done, 0.20.0-beta.236**; ~~dev HMR follows the swapped page (`__HMR_FRAMEWORK__`, per-page manifest)~~ **verified, 0.20.0-beta.237 — it already did**; a framework-supplied index boot function instead of `?absolute-nav=` re-imports. Exit: React ↔ Svelte ↔ HTML ↔ HTMX with islands **(rows done, 0.20.0-beta.240 — see 4f for what of "with islands" and "heap snapshot" is not)**, no leaked roots (heap snapshot), HMR edit after a soft navigation applies **(done)**. |
| 3 | Vue + Angular | ~~Vue `<Link>` / vue-router hands off unmatched URLs~~ **verified, 0.20.0-beta.238 — it already did**; ~~Angular `routerLink` hands off unmatched URLs~~ **done, 0.20.0-beta.247 — it did not; it was a dead link, see 4e**; ~~Angular zone and platform teardown verified~~ **verified, 0.20.0-beta.239**. Exit: the Phase 1 suite for every framework pair (5×5 matrix in Playwright, prod + dev). |
| 4 | Navigation API interception | ~~`navigate` event `intercept()` where supported (forms, `location.assign`, programmatic), click/popstate fallback elsewhere~~ **done, 0.20.0-beta.249 — see 4h**; ~~`config.navigation: true` injects `enableNavigation()` into every hydration index~~ **done, 0.20.0-beta.245**. Exit: suite passes in Chromium (Navigation API) and WebKit/Firefox (fallback) — Chromium both ways (the API removed in-browser); no WebKit/Firefox runner in CI yet. |
| 5 | Persistent layouts | `data-absolute-persist` (2.4) plus layout-route emission. **Designed against a prototype, not yet implemented — see 4i**, which has the mechanism, the two constraints that block it and the live double-mount defect to fix first. Exit: a React navbar island keeps state (input value, open menu) across React → Svelte → Vue. |

## 4a. Island teardown (phase 2, shipped)

`src/client/islandDisposers.ts` holds, for each hydrated island, the call
that tears it down. The navigation layer runs them for everything inside
the body it is about to replace, before the page's own
`__ABSOLUTE_PAGE_DISPOSE__`. That order matters: a framework page root may
own the markup an island is mounted into, so tearing the page down first
detaches the island's host element and the island then unmounts against
nodes that are already gone.

Three things about it worth knowing:

- **The store is on a `Symbol.for` key**, not module-level. Each
  framework's client pass bundles its own copy of
  `@absolutejs/absolute/client`, so a module-level collection would be one
  store per copy: a React page's navigation layer would not see the
  disposer its Svelte island registered. Same reason the island store
  snapshot and the streaming-slot registrar live there.
- **The hydrators register themselves.** `islandDisposers.ts` has no
  imports, so nothing that imports it pulls in a framework. Each hydrator
  is already loaded by a dynamic import only when an island of that
  framework is on the page, and it registers its own disposer there —
  React unmounts its root, Svelte awaits `unmount`, Vue unmounts its app,
  and an Angular island is detached from the shared island application and
  destroyed. The shared Angular application itself is left running: it is
  created once per document and the next page's islands attach to it.
- **Detached islands are pruned on every pass.** The store holds elements
  strongly, so an island removed by its host framework rather than by a
  navigation would be held here instead — one leak traded for a smaller
  one. A `WeakSet` cannot be iterated, so it cannot answer "unmount
  everything under this node".

An island outside the swapped region is left mounted, which is the shape
persistent layouts need (2.4, phase 5).

Verified in `tests/integration/build/island-teardown-browser.test.ts` with
a Svelte island on a React page — the case where the disposer and the
navigation layer are in different bundle copies. The island runs an
interval, and the test asserts the tick count stops moving after the
navigation as well as that `onDestroy` ran: a flag could be set by a
teardown that left the timer going.

## 4b. Static pages taking part (phase 2, shipped)

`canTearDown()` gates the whole layer: a page that registered no
`__ABSOLUTE_PAGE_DISPOSE__` falls back to a full document load. For a
framework page whose index never finished that is the safe outcome — there
is a half-mounted app whose markup must not be pulled out from under it.
For a static HTML or HTMX page it was simply wrong: there is nothing to
tear down, so static pages could be navigated **to** and never **from**,
and a React → HTML → React trip soft-navigated once and then reloaded.

A page is marked as having nothing to tear down in the two cases where
that is known rather than guessed:

- **Swapped in.** The document the layer just inserted has no module
  script and no inline `import()` (`loadsModules`), so no hydration index
  is coming and nothing will register a hook. The static page needs no
  script of its own for this.
- **Entered cold.** `enableNavigation()` finds no hook already registered.
  A static page that is the entry point has to load the client module and
  make that call anyway to intercept its own links, so the call that
  installs the layer is also what says there is no app behind it.

A document that *does* load modules is left alone, so a framework index
that failed still falls back to a full load. The mark never replaces a
real hook, and the two cannot race on a framework page: an index registers
its hook at module evaluation, and `enableNavigation()` is documented to
be called from a component (a React effect, a Svelte `onMount`), which by
definition runs after that. Calling `enableNavigation()` from a plain
inline script on a *framework* page is the one way to invert that order,
and it is already against the documented usage.

Verified in `tests/integration/build/static-page-navigation-browser.test.ts`
for both routes, asserting zero document requests across the round trip —
a reload would pass a "did we arrive" check and lose the entire point.

## 4c. One prefetch store per document (phase 2, shipped)

`src/client/prefetch.ts` keeps its state on a `Symbol.for` key rather than
in module scope. Each framework's client pass bundles its own copy of
`@absolutejs/absolute/client`, so module-level state is one set per copy,
and the cache was therefore useless across frameworks: a Svelte `<Link>`
hover warmed the Svelte copy, while the layer doing the swap — whichever
copy called `enableNavigation()` first, which on a React-entry session is
React's — looked in its own and missed. The document was fetched twice.

Everything a document can only sensibly have one of moved with it, not
just the cache:

- **The in-flight budget.** `MAX_IN_FLIGHT` was enforced per copy, so two
  copies could run four prefetches at once on a page already fetching its
  own assets.
- **The `<link>` and speculation-rule bookkeeping**
  (`preloadedModules`, `prefetchedStyles`, `liveSpeculationRules`), which
  could otherwise inject the same hint twice and exceed
  `MAX_LIVE_SPECULATION_RULES`.

The call sites did not change: the shared Maps, Sets and array are
destructured once at module init, so each copy holds a reference to the
same objects under the same names. Only the in-flight count needed a box,
since a number cannot be shared by reference.

`tests/unit/client/prefetch.test.ts` bundles the module and evaluates it
twice — two independent module instances sharing one global, which is what
two bundle copies are — and asserts that one copy sees the other's
prefetch, that consuming it empties the store for both, and that the
in-flight budget is one budget. An import would have been deduplicated and
tested nothing.

## 4d. Dev HMR after a soft navigation (phase 2, verified)

This one needed no change. `tests/integration/dev/soft-navigation-hmr-browser.test.ts`
drives a React page, soft-navigates to a Svelte page and edits that page's
source, and the update applies with zero document requests. Two things that
were in doubt both hold:

- `window.__HMR_FRAMEWORK__`, which the HMR client is keyed on, reads
  `svelte` after the swap. The Svelte hydration index re-runs on swap-in
  and sets it.
- No second HMR client installs. The index delivers the client with
  `import`, and the navigation layer skips module URLs it has already
  evaluated. (Vue and Ember page handlers emit the client as an *inline*
  `<script data-hmr-client>`, which a swap would re-execute, and there is
  no double-install guard in the client. Not reached by this test; worth
  covering when phase 3 adds those two frameworks.)

**Why it was never verified before, and the trap to avoid.** The example
app calls `enableNavigation()` nowhere, so no app in the repo did both
soft navigation and HMR. Writing one is not quite free: `HARD_DENY_PATTERN`
in `src/dev/pathUtils.ts` lists `.test-builds`, so the dev watcher ignores
every change under the directory that every *build* integration test uses
for its fixtures. A dev-HMR fixture there gets no rebuild, no WebSocket
message and no log line — the test fails as a silent timeout. This
fixture lives in `.hmr-temp/` instead, which is gitignored and not denied.

## 4e. The matrix, framework by framework (phase 3, in progress)

**Vue: verified, no change needed.** `src/vue/router/Link.ts` already has
the hand-off the phase asks for — with no vue-router on the page, or an
`href` its routes do not match, `onClick` returns without calling
`preventDefault`, so the click reaches the layer's bubble-phase window
listener. `compileVue`'s index already registers
`__ABSOLUTE_PAGE_DISPOSE__`, so a Vue page can be left as well as entered.
`tests/integration/build/vue-navigation-browser.test.ts` asserts the round
trip: React → Vue swaps in place, the Vue page is interactive (its counter
increments, so this is hydration rather than server markup pasted in),
`<Link href="/react">` hands back to the layer, and back/forward traverse
both ways — all with zero document requests.

**Angular: verified, and its teardown with it.**
`tests/integration/ssr/angular-navigation-browser.test.ts` soft-navigates
React → Angular → React. The Angular page is interactive before leaving
(its counter increments, so it is a hydrated application rather than
server markup pasted in), `__ANGULAR_APP__` is live on arrival and falsy
after leaving, and no document is requested. The teardown assertion is
the Angular-specific one: `compileAngular` registers an *async* dispose
hook that awaits the page-ready promise and then destroys the
application, so if the layer did not await it a zone, a change-detection
loop and the whole injector tree would keep running against a body that
is gone. It is asserted in both directions — truthy on arrival, falsy
after — because "destroyed" alone would also pass if the global were
never set.

**Do not simplify that test's harness.** It writes its fixture to a temp
directory, symlinks this checkout's `node_modules` in with
`@absolutejs/absolute` pointing at the repo, and starts the app through
`dist/cli/index.js` — the same shape as the `@defer` hydration test next
door. An earlier attempt built it like the `tests/integration/build`
fixtures, calling `handleAngularPageRequest` in-process, and every Angular
SSR render failed with `NG0203` (`inject()` outside an injection context)
from inside Angular's own `createRootViewInjector`, before reaching any
navigation code. Importing `src/angular/injectorPatch`, including as the
very first import in the file so it ran before `@angular/core`, did not
help; neither did moving the page's `enableNavigation` import to a lazy
`import()`. Why the in-process path breaks Angular's injector is still
not known — only that going through the package entry in a real app does
not.

`absLink`, the prefetching link directive (parity item 2.8, and the API
the roadmap already specified), shipped in 0.20.0-beta.241:

```html
<a absLink href="/pricing">Pricing</a>
<a absLink prefetch="hover" href="/docs">Docs</a>
```

It never calls `preventDefault`. `routerLink` is Angular's way to
navigate inside an Angular router, and a directive competing for clicks
would fight it — this one warms the cache and lets the click go wherever
it should, the navigation layer or the browser. Its prefetch kinds match
what `usePrefetch` gives the other frameworks: a deliberate signal
(hover, focus, pointerdown) takes `'route'`, the document plus the
payload naming the modules and CSS to warm with it, and scrolling into
view takes `'document'`.

It reaches the prefetch runtime through `src/utils/prefetchRef.ts`, an
import-free indirection on a `Symbol.for` key that `src/client/prefetch.ts`
registers itself with as it loads. A component in
`src/angular/components` cannot import the real module: the partial
compile copies that directory alone into a flat workspace, and an import
climbing out of it makes the step emit **nothing**, publishing every
Angular component empty while the build reports success. The same
treatment `csrfTokenRef` gets — rewrite, copy, and its own `Bun.build`
entrypoint because the tsc pass skips subdirectory emits.

**`routerLink` hand-off: shipped, 0.20.0-beta.247**, and it was a real
dead link rather than a wording question. On a page that exports `routes`,
`routerLink="/react"` did *nothing*: the router failed with NG04002, the
address bar never changed, and the only trace was a console error that a
production build strips to `'react'` — no route table, no URL, nothing to
search for. Probed in the browser before anything was written, because
"what does it do today" and "what should it do" are different questions
and only the first one has an answer in the code:

```
URL AFTER CLICK: http://localhost:60358/ng/
react-page: 0 angular-page: 1 routed-home: 1
error: ERROR RuntimeError: NG04002: 'react'
```

The fix is an Angular navigation-error handler
(`src/angular/components/router-handoff.ts`) wired into the
`provideRouter(...)` that `compileAngular` injects for a colocated-routes
page. A no-match goes to the navigation layer — a soft swap when one is
installed, a page load otherwise, the same fallback `navigateDocument()`
makes. Four decisions in it worth keeping:

- **Only NG04002.** Every other navigation error returns `undefined` from
  the handler, which is Angular's own reporting path. A failed guard or a
  resolver that threw must stay an error; turning either into a page
  navigation would hide it.
- **The URL handed off carries the base href** —
  `location.prepareExternalUrl(event.url)`. The router's URL space is
  relative to `APP_BASE_HREF`, so `routerLink="/pricing"` on a page
  mounted at `/portal/*` means `/portal/pricing`, and handing off
  `/pricing` instead would make a link's target depend on whether the
  route table matched it. Leaving the mount is `absLink`'s job.
- **Never hand off the page's own URL.** When the unmatched URL is the one
  the document is already on, the hand-off would ask the layer to navigate
  where it is — an infinite reload on the page-load fallback. Angular
  reports it instead.
- **The handler returns a `RedirectCommand` to the current URL.** Not
  decoration: returning nothing makes the router re-throw the error it
  just handed over, which is the console error and the rejected
  `navigateByUrl` promise the dead link already produced. Staying put is
  also honest — the document is on its way out either way.

The handler reaches the injected `provideRouter(...)` through a global
(`ROUTER_HANDOFF_KEY`) that the page's hydration index publishes, not by
being imported there. CI found the reason: the compiled page module is
loaded by the server **unbundled**, from the generated directory, so a
`@absolutejs/absolute/...` specifier in it has to resolve at runtime —
and the unit job runs `test:unit` before `bun run build`, so
`tests/unit/angular/colocatedRoutesPage`, which compiles a page into a
temp directory and renders it, had no `dist/` to resolve against and
every render returned the SSR error page. It passed locally only because
a built `dist/` was sitting there. The index is bundled at build time,
where the specifier resolves once; and on the server the global is unset,
which is the right answer anyway, since a hand-off is a browser concept.

Not covered by `withNavigationErrorHandler`: it is a single provider, so
an app that both uses colocated `routes` and supplies its own handler
through its own `provideRouter` call would have two routers to begin with.
`absoluteRouterHandoff` is exported for apps that wire their own.

`tests/integration/ssr/angular-router-page-navigation-browser.test.ts`
covers the routed page end to end — a `routerLink` the table *does* match
staying the router's (outlet changes, document does not, application not
re-bootstrapped), the unmatched one handing off, `absLink` leaving the
mount, and a soft navigation into `/ng/inner` from outside rendering the
inner route rather than the index. `tests/unit/angular/routerHandoff.test.ts`
covers the decision itself, including the production-shaped error whose
message is only `'react'` — reading the message alone would make the
feature work in dev and quietly do nothing in a build.

## 4f. Where the matrix actually stands

Verified, each with its own browser test against a real production build,
asserting zero document requests:

| Row | Test | Note |
| --- | --- | --- |
| React ↔ Svelte | `cross-framework-navigation-browser` | Phase 1 |
| React ↔ Svelte, with a Svelte island on the React page | `island-teardown-browser` | Island unmounted on the way out |
| React ↔ HTML, both entered cold and swapped in | `static-page-navigation-browser` | |
| React ↔ Vue | `vue-navigation-browser` | Vue page interactive before leaving |
| React ↔ Angular | `angular-navigation-browser` | Application destroyed on the way out |
| React ↔ HTMX | `htmx-navigation-browser` | `hx-get` still works on the swapped-in page |

The HTMX row's real question was not the swap — an HTMX page is a static
page — but whether htmx still binds a body the layer inserted. It does:
the page's `<script src=".../htmx.min.js">` is a classic script, so
re-inserting it re-executes it and htmx initialises against the new
document. The layer never calls `htmx.process`, unlike the dev HMR
handler (`src/dev/client/handlers/htmx.ts`), and does not need to. That
test carries a control that enters the page directly, so a failure
separates "htmx is broken here" from "the fixture is wrong" — which is
how the missing vendor copy in the first draft was caught rather than
mistaken for a navigation defect.

**Two things in phase 2's exit wording are still not literally met**, and
should not be read as done:

- *"with islands"* is verified only on the React ↔ Svelte leg. Islands on
  an HTML or HTMX page across a navigation are not covered.
- *"no leaked roots (heap snapshot)"* is verified behaviourally — the
  disposer registry empties and the island's interval stops — not with a
  heap snapshot.

**The first non-React pair: Svelte ↔ Vue** (0.20.0-beta.246), and worth
its own row rather than being assumed from the React ones. Each
framework's client pass bundles its own copy of
`@absolutejs/absolute/client`, so the copy that installs the layer and
the copy that hydrated the page being torn down can be different
modules — which is exactly where this area's bugs have been: the
prefetch cache was one store per copy (beta.236), and the island
disposer registry had to move to a `Symbol.for` key for a React page's
layer to see a Svelte island's disposer (beta.234). Driven from BOTH
entry points, because `enableNavigation()` is idempotent and the first
caller wins, so which copy owns the layer depends on where the session
started — and the teardown path differs per framework, so one direction
says nothing about the other. No framework change was needed.

A note for whoever writes the next one of these: `window` survives a
soft navigation by design, so a `__hydrated` flag set by the first visit
is still true when the second starts, and waiting on it returns
immediately. The first draft of that test did exactly that and asserted
the URL before the navigation had finished — it showed up as the wrong
pathname rather than as a timeout. Clear the flag, click, then wait.

| Angular, routed page ↔ React | `angular-router-page-navigation-browser` | `routerLink` hand-off; a matched `routerLink` stays the router's |

Phase 3 still needs, for a complete 5×5: the remaining Angular pairs —
which need the spawned-app harness of 4e rather than an in-process
server — and the HTMX pairs.

## 4g. `navigation: true` (phase 4, partly shipped)

`navigation: true` in absolute.config.ts installs the layer from every
hydration index, so an app does not repeat `enableNavigation()` in each
page component. The layer stays opt-in per page without it — right for a
page that wants to stay out — but repeating the call in every
effect/`onMount`/`ngOnInit` is a papercut, and forgetting it on one page
silently turns every link out of that page into a full document load,
which looks like nothing at all until someone watches the network.

Implemented with a build-wide setter (`build/navigationAutoEnable.ts`)
rather than threaded through `generateReactIndexFiles`, `compileSvelte`,
`compileVue` and `compileAngular`, which all take positional optionals
already; `build()` sets it on every run from its own config, so a dev
rebuild or the next test in the same process overwrites it. Same shape as
`setSvelteVendorPaths`. For Angular it is applied **before** the index
hash that decides whether bundling can be skipped — hashing the
unwrapped source would let a stale index survive the flag being turned
on.

The snippet is appended last and its import hoists, so the call runs
after the index has registered its teardown hook. That ordering matters:
`enableNavigation()` marks a page with no hook as having nothing to tear
down, so running it first would mark a framework page as tear-down-free.

Verified by building two apps from identical sources, one with the flag
and one without, whose pages import nothing from
`@absolutejs/absolute/client/navigation` and never call
`enableNavigation()`. With the flag the navigation is a swap with zero
document requests and the target is interactive; without it the same
pages do a full document load. The second case is what makes the first
mean anything.

**Not covered.** A static HTML or HTMX page that is the ENTRY point has
no hydration index to inject into, so it still imports the client module
and calls `enableNavigation()` itself; one swapped in by another page
needs nothing (4b).

## 4h. `navigate`-event interception (phase 4, shipped)

A form submission and a `location.assign()` never reach a click listener,
so until 0.20.0-beta.249 they reloaded the document: an app that submits
a search form paid for a fresh document, and lost its island state, on a
navigation that could have been a swap. Where the Navigation API exists,
its `navigate` event sees both, and `intercept()` is how a page takes one
over (`listenForNavigations` in `src/client/navigation.ts`).

**Clicks stay with the click listener.** It runs first and either prevents
the default — in which case no `navigate` event is ever fired — or records
a decline. Keeping clicks there keeps `download`, `target`,
`rel="external"` and `data-absolute-navigation="off"` read off the anchor,
where they live.

**The one property that makes this safe is `destination.sameDocument`**,
and it took a browser to find out why. `history.pushState` and
`history.replaceState` fire `navigate` events too (type `push`/`replace`,
`sameDocument: true`). The first version of this listener did not check
it, and:

- the layer's own `commitHistory` push was a navigate event the layer
  then intercepted, which swapped, which pushed — a loop that ends with
  Chromium's *"Throttling navigation to prevent the browser from
  hanging"*, the URL frozen one navigation behind the DOM;
- worse than the loop, **every framework router changes route by calling
  `pushState`**, so an app's in-router navigation would have been
  answered with a full cross-framework document swap.

Both come from the same mistaken assumption, which is why the browser
test asserts a page's own `pushState` is left alone — on a URL that *is*
a real page, so an interception would look like success.

**Deliberately not intercepted:**

| Kind | Why |
| --- | --- |
| `pushState` / `replaceState` | Same-document. The app (or a router) is handling it. |
| A POST form (`formData` present) | The swap fetches the target with GET, so taking this over would turn a submission into a read of the action URL. Form actions (`useFormAction`, `absAction`) are how a POST stays on the page. |
| `traverse` / `reload` | Back and forward belong to the popstate listener; a reload belongs to the browser. |
| `downloadRequest` | A file, not a page. |
| An opted-out element | Checked twice: the event's `sourceElement` climbs to `[data-absolute-navigation="off"]` (for a form submission that element is the submit BUTTON, so the check has to climb), and the click listener's own decline is recorded for a short window, since `sourceElement` is newer than the API and cannot be the only answer. |
| Anything while the layer is handing off | `reload()` hands a failed navigation to the browser with `location.assign`, which is itself an interceptable navigation — retrying what just failed is a loop. |

Two mechanical details the swap depends on:

- **Scroll is remembered before `intercept()`**, not inside the handler.
  The API commits the destination entry the moment `intercept()` is
  called, so by the time the swap runs the entry being left is no longer
  the current one and its position would be filed under the wrong key.
- **`managedHistory`** tells the swap not to push: the entry exists
  already. It stamps the entry it is on with `replaceState`, which also
  settles a redirect — the entry carries the URL asked for, and the URL
  arrived at goes there.

`focusReset: 'manual'` and `scroll: 'manual'` keep the API from doing
what the swap already does, in the wrong order.

**Safari and Firefox have no Navigation API**, so a form there still
loads a document. That is the documented floor, and the suite asserts
both halves of it with the API removed: the form loads a document, and a
LINK still swaps — the half that could regress silently.

## 4i. Persistent layouts: what a prototype found (phase 5, design)

Phase 5's exit criterion is the payoff for everything phases 1 to 4 built:
a React navbar island keeps an open menu and a typed-in value across
React → Svelte → Vue. Nothing mainstream does that, because nothing else
has to.

This section is the result of building it as a throwaway prototype first,
rather than writing the plan from the code. **The mechanism works. Two
things in its way do not, and one of them is a live defect that has
nothing to do with phase 5.**

### The mechanism, and it is small

A subtree marked `data-absolute-persist="<key>"` on both the current page
and the incoming one is moved rather than re-created: in the swap, after
the head is swapped and before `document.body.replaceWith`, each live
subtree replaces its twin inside the *incoming* body, which the next line
makes the live body. The subtree therefore goes straight from one body to
the other and is never detached in between.

Proven in a browser: a Svelte island hydrated on a React page survived the
trip into a Svelte page with the value typed into it, mounted exactly
once, never destroyed, its interval still counting. A key only one page
declares is not persisted — a layout the next page never asked for has to
be torn down, or this feature is beta.234's island leak with a nicer name,
and that case is asserted too.

### Constraint 1: the disposer registry unmounts anything detached

`disposeIslandsIn` unmounts every island inside the root it is given **and
prunes any whose element has left the document**. That pruning exists to
stop a leak (beta.234), and it is exactly wrong here: a persisted subtree
is, for an instant, in neither document. The pass needs to know what the
navigation intends to keep — a `keep` predicate the layer supplies from
the matched pairs. Cheap, and it has to come first; without it the
navigation unmounts the very island it was asked to preserve.

### Constraint 2: an incoming framework hydrates over the moved nodes

This is the real design problem, and the prototype hit it the moment both
pages rendered the layout rather than one page declaring an empty marker.

A persisted subtree is placed where the incoming page's markup says it
goes — and then the incoming page hydrates. React tolerates this already:
`<Island>` renders a marker div with `suppressHydrationWarning` and no
children, which is why islands survive React hydration today. Svelte does
not: its island slots lower to an `{@html}` expression that re-inserts the
slot's markup on hydration, which replaces the moved nodes with fresh
ones. The mount count read 3 instead of 1.

So a persisted subtree cannot simply sit inside the incoming page's
component tree. Two ways out:

1. **A region the page framework does not own.** Svelte, Vue and Angular
   mount into a root element, so a `<body>`-level sibling of that root is
   outside all three. React owns the document, so it must render the host
   itself — with the `<Island>` trick, which is known to work. The layer
   moves the host; pages declare where it goes rather than what is in it.
2. **Hydrate, then replace.** Let the incoming page hydrate its own copy,
   then swap the live subtree in and dispose the copy. Framework-agnostic
   and robust, at the cost of mounting an island that is thrown away one
   frame later — which for a video player or a map is not a detail.

(1) is the better shape and the more work; (2) is a fallback worth keeping
for a subtree a page insists on rendering inline. Neither can be chosen
without constraint 3 being fixed first.

### Constraint 3: a live defect, found by measuring the prototype — fixed, 0.20.0-beta.252

On a Svelte page with an island, entered cold, the island mounts **twice**
and leaves the first instance running on detached nodes:

| Page entered cold | `__islandMounts` | `[data-island]` in DOM | disposers registered |
| --- | --- | --- | --- |
| React | 1 | 1 | 1 |
| Svelte | **2** | 1 | **2** |

Two disposers for one element is a zombie: an island instance with its
effects, timers and subscriptions alive, attached to nodes no longer in
the document, held by the registry until the next navigation prunes it.
Every Svelte page with an island pays this on every load, and it is
unrelated to persistence — it is the same `{@html}` re-insertion as
constraint 2, hitting the island the page itself rendered.

It is also the follow-up noted on beta.250's pull request, now measured
rather than suspected.

**Fixed in 0.20.0-beta.252**, and the rule it ended up following is the
one phase 5 needs: *fill the slot only when it is empty*. The client
lowering emits no children for an island slot and a `use:` action that
writes the markup only when no island is there, so a hydrating page leaves
a live island exactly where it is and a mounting one (client render,
discarded server markup, HMR remount) still gets its markup.

Three forms were tried in a browser, and the order of findings is the
useful part:

| Client slot | Hydrating page | Mounting page |
| --- | --- | --- |
| `{@html await resolve()}` (before) | island re-created, hydrated twice, first instance orphaned | works |
| `{@html resolve()}`, synchronous | **still** re-created — `{@html}` writes on hydrate either way, so the `await` was not the cause | works |
| `{#if needsMarkup()}{@html …}{/if}` | island **removed**: the block's hydration anchors make Svelte delete the nodes between them | works |
| empty element + `use:` action (shipped) | untouched, one instance, one disposer | action fills the empty slot |

The thing worth remembering: an element whose client template has no
children keeps the DOM children it already has, and the moment that
emptiness is expressed as a block — an `{#if}`, and by extension an
`{#each}` or a component boundary — Svelte owns the range and clears it.
That is the constraint any phase 5 persisted region has to live inside.

### Shipped: `persist` on an island (0.20.0-beta.254)

Steps 1 to 3 below are done, and step 4 turned out not to be needed in the
shape it was written. **The unit of persistence is an island, not an
arbitrary subtree**, and that single change answers constraint 2 without
a region outside the page framework's root:

```tsx
<Island component="Navbar" framework="react" persist="navbar" props={{}} />
```

An island is already the one thing every framework's hydration leaves
alone. React renders its host with `suppressHydrationWarning` and no
children; a Svelte island slot writes only when it is empty (beta.252,
which had to be fixed first and is why that order mattered). A subtree of
page-owned markup has no such protection, and never could — the page app
is unmounted on every navigation, so persisting markup it owns would keep
nodes whose component is gone.

`persist` goes on the island's marker attributes
(`core/islandMarkupAttributes.ts`), so it is in the markup the server and
the client both write, for every framework's `<Island>`. The layer matches
live islands against incoming ones by key, moves each live element into
the incoming body in place of its twin just before that body becomes the
live one, and tells `disposeIslandsIn` to spare them (constraint 1). A key
the incoming page does not render is not persisted and is torn down with
the rest of the page.

Verified in a browser both ways — React → Svelte, Svelte → React and a
round trip — on a Svelte island that both pages render: never mounted a
second time, never destroyed, its interval still counting, still holding
what was typed into it, with zero document requests. The control is a page
that renders no island with the key: the island is destroyed and the
disposer registry empties, because persisting everything always is the
wrong implementation that would otherwise pass.

### A Vue page as the destination works (0.20.0-beta.255) — and a correction

**It works.** A persisted island arriving on a Vue page keeps its
instance: one mount, nothing destroyed, the typed value and the running
interval intact, same as a React or Svelte destination.

The previous revision of this section said it could not work, and gave a
mechanism: *"Vue removes DOM children that its vnode does not have, so its
hydration deletes the moved island."* **That was wrong**, and the way it
was wrong is worth keeping.

The real cause was one line of plumbing: Vue's `<Island>` did not declare
a `persist` prop, and Vue drops undeclared props. So a Vue page's island
markup carried no `data-absolute-persist`, the layer found no twin to
match, and the island was never moved at all — it went out with the old
body like any unpersisted island. Declaring the prop fixes it; nothing
about Vue's hydration needed changing.

The wrong mechanism came from misreading a timeline I had measured myself:

```
t+50:   connected=true   vue=undefined  mounts=1
t+150:  connected=false  vue=true       mounts=2
```

I read that as "the island was moved, then Vue's hydration removed it".
But those timestamps are relative to the CLICK, and the swap takes longer
than 50ms: at t+50 the old page was still live, which is why the element
was still connected. The element never moved. `vue=true` appearing in the
same row as `connected=false` made hydration look like the cause, when
both were simply the state after a swap that had not persisted anything.

Two attempts were built on that wrong mechanism and are reverted:
rendering the Vue island host with no children and filling it in
`onMounted` (the shape that fixed Svelte), and `data-allow-mismatch` on
every island host. A third was written and also removed: a reclaim pass
that watched for a moved island leaving the document and put it back.
It passed its test for the wrong reason — the test it was written against
started passing because of the prop fix, and dropping the whole watch
changed nothing.

**The lesson for the rest of this phase**: a measurement answers the
question it was pointed at, not the one being asked. "Is the island in the
document?" sampled on a timer answers nothing about *why* it is not, and
an elapsed-time label is not an event. Holding a reference across the
navigation and asserting on identity — `live === document.querySelector(…)`
— is what finally said "this element was never moved", in one line.

### An Angular page: measured, and it has beta.252's defect (0.20.0-beta.256)

Measured with the spawned-app harness. **An island on an Angular page
works** — it hydrates, it is interactive, and it still is after a soft
navigation into the page, which is a matrix row that had no test and now
does. Two things do not work, and they are the same fault:

| Angular page, entered cold | `__islandMounts` | `[data-island]` in DOM | disposers |
| --- | --- | --- | --- |
| today | **2** | 1 | **2** |

That is beta.252's Svelte defect in a third framework: the island is
hydrated from its own bootstrap, then hydrated again, and the first
instance is left running on detached nodes. And it is why `persist` does
not survive a navigation into an Angular page either — the live island
that the layer moves in is inside the container Angular throws away.

The cause is specific and different from the Svelte and Vue ones:
`src/angular/Island.browser.ts` renders `<div #container ngSkipHydration>`
and writes the island's markup into it. `ngSkipHydration` means Angular
**client-renders** that subtree rather than hydrating it, so the container
Angular ends up with is a fresh element — the server's container, with the
island the bootstrap already hydrated, is discarded. There is nothing to
"not overwrite": the rule that fixed Svelte (write only when empty) cannot
fire, because the container is always empty by then. A guard for it was
written, found to be dead code, and removed.

**Resolved for `persist`, 0.20.0-beta.257: the container adopts.** The
projection route is not available — the server replaces the whole
`<absolute-island>` element with the island's markup, so there is no host
element for Angular to hydrate at that position, which is why
`ngSkipHydration` is there at all. The container therefore stays
client-rendered, and the component now looks for the live island before
writing markup: by `data-island-id` (which the server gives every island,
and which `preserveIslandMarkup` carries into the component's own
attributes, so two islands of one component with identical props cannot be
mistaken for each other), else by `persist` key. It looks in the document
first and in the disposer registry second — by the time a navigation
brings a persisted island in, the element is detached and the registry is
the only thing still holding it. That is what `registeredIslandElements`
exists for.

A persisted island arriving on an Angular page is therefore the same
instance that crossed, asserted on identity (`live ===
document.querySelector('[data-island]')`), with its typed value intact.

**The component also used to write its markup twice.** `applyMarkup` runs
from both `ngOnChanges` and `ngAfterViewInit`, and its
`innerHTML === markup` guard does not stop the second call: by then the
islands runtime has hydrated what the first call wrote, which changes the
container's HTML. So the second write replaced a live island with a fresh
copy. It now returns early when the container already holds an island,
whoever put it there.

### Still open: an Angular page entered cold hydrates its island twice

Two disposers for one element in the document, which means a **second,
detached element exists**. Four explanations are ruled out by measurement:

| Explanation | Ruled out by |
| --- | --- |
| The component writes twice | Fixed; logging shows one write, count unchanged |
| A detached element is hydrated | A skip-if-detached guard changed nothing |
| Two copies of the islands runtime race on one element | A `data-hydrating` DOM claim, shared by all copies, changed nothing |
| Vue-style re-creation of the host | Angular's container is empty when written; nothing to re-create |

The last two were written, measured, and reverted rather than shipped —
a check that cannot be shown to fire is the speculative machinery this
phase has already produced twice.

What is known: at the time the component writes, the document holds **no**
islands at all (`allIslands=0`) and the registry is empty, so the second
element appears after that. Where it comes from is the next thing to find,
and the honest next step is to log every `registerIslandDisposer` call
with its element's identity and parent chain, rather than to guess a fifth
mechanism.

Layout-route conventions emitting `persist` automatically (step 5) are
also still open.

### Order of work for phase 5

1. ~~One preserved-node mechanism, and the Svelte island slot stops
   re-creating a hydrated island~~ **done, 0.20.0-beta.252.**
2. ~~`disposeIslandsIn(root, keep)`~~ **done, 0.20.0-beta.254.**
3. ~~The layer's move~~ **done, 0.20.0-beta.254.**
4. ~~A persisted region outside the page framework's root~~ **not needed:
   an island is the region (see above).** What remains of this step is
   verification rather than design — a Vue page and an Angular page as the
   destination of a persisted island.
5. Layout-route conventions emitting `persist` automatically, which is
   what makes this ergonomic rather than a hand-written attribute.

The prototype is not in the repository. It was ~70 lines in
`src/client/navigation.ts` plus the `keep` predicate, and the browser test
that drove it is worth rebuilding rather than reviving: it asserted the
kind of state a store cannot carry (a typed value, a running interval, a
mount count), because `createIslandStore` state already survives a
navigation and a test that checked a store value would have passed with
none of this built.

## 5. Known limitations (phase 1)

- A revisited page's index module is downloaded again under a new query
  string (small; vendor chunks are not).
- `history.state` gains an `__absoluteNavigation` key only in browsers
  without the Navigation API.

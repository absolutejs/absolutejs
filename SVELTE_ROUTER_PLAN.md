# AbsoluteJS Svelte Router — Plan

A small, library-style router authored and maintained by AbsoluteJS, shipped
as a sub-export of `@absolutejs/absolute`. Fills the gap left by Svelte not
having a first-party router, sidesteps the bundler problem of consuming
third-party packages that ship raw `.svelte` source files, and matches the
posture of every other framework adapter (intra-framework SPA via a router
that AbsoluteJS users opt into per-page).

## 1. Goal & non-goals

**In scope:**

- Declarative routing inside an AbsoluteJS Svelte page: `<Router>`,
  `<Route>`, `<Link>`, `goto()`, `page` rune, `pushState()` /
  `replaceState()`.
- SSR + hydration cooperation: server passes the URL into `<Router>`,
  client picks up from there.
- View Transitions API integration on navigate (carry pattern from
  `src/dev/client/` Angular HMR).
- Prefetch on hover (default) and viewport (opt-in via attribute), in line
  with the future cross-framework `<Link>` story in ROADMAP.md item 1.5.
- TS-first: `<Route>` typed via Svelte 5's generic component syntax.
- Drop-in compatibility with AbsoluteJS's wildcard Elysia route pattern
  (`/portal/*` server route → page handler → `<Router url={...}>` on
  server, `<Router>` on client).

**Out of scope (v1):**

- Filesystem routing (that's SvelteKit's identity).
- Data loaders (`+page.server.ts`-style). Users use Elysia loaders + props.
- Form actions. ROADMAP.md item 3 covers this framework-agnostically.
- Adapter abstractions. AbsoluteJS pages register through Elysia.
- Nested layouts via filesystem. `<Route>` already supports children/slots
  for shared layout via the page tree.

**Explicitly NOT a SvelteKit replacement.** Users who want filesystem
routing + data loaders + adapters should use SvelteKit. Users who picked
AbsoluteJS for the multi-framework + Elysia + Bun story get a small router
that Just Works inside their Svelte pages.

## 2. Why we ship this rather than recommend a third-party

Three reasons in increasing order of importance:

1. **Svelte has no first-party router.** Every other framework adapter
   (React, Vue, Angular) cooperates with the framework's own router
   ecosystem; for Svelte that ecosystem is "pick a third-party". We can
   pick *for* the user, OR we can author one. Authoring is better DX.
2. **Maintenance is small.** `svelte-routing` (the de-facto third-party)
   is ~500 lines of Svelte. The router surface we need is `<Router>` /
   `<Route>` / `<Link>` / `goto()` / `page` rune and not much else.
   Compare to what AbsoluteJS already maintains (Angular linker, Vue
   HMR runtime, Bun patches, cross-framework islands) — a small Svelte
   router is a rounding error.
3. **It sidesteps the `.svelte`-in-node_modules bundler problem entirely.**
   `svelte-routing` and similar packages publish raw `.svelte` source
   files. Bun has no built-in Svelte plugin, so the server bundle pass
   fails to compile them. The general fix would be "build a Bun plugin
   that compiles node_modules `.svelte` files" — that's *more* code than
   just authoring the router, because we'd be solving every Svelte-source-
   shipping package's bundler problem forever. If we author the router and
   ship it as compiled JS in `dist/svelte/router/`, the whole class of
   problem disappears.

## 3. Public API

All exports from `@absolutejs/absolute/svelte/router`.

### 3.1 `<Router>` — context provider

```svelte
<script lang="ts">
  import { Router } from "@absolutejs/absolute/svelte/router";

  // SSR: parent passes url from request.
  // Client: omitted; reads from window.location.
  let { url }: { url?: string } = $props();
</script>

<Router {url}>
  <!-- routes go here -->
</Router>
```

Props:
- `url?: string` — the SSR URL; omitted on client where `window.location`
  is read instead.
- `basepath?: string` — optional URL prefix. Useful if the page is mounted
  at `/portal/*` and you want `<Route path="/">` to match `/portal/`.

Internally provides Svelte 5 context with the current location store +
navigate function.

### 3.2 `<Router>` mode prop

In addition to `url` and `basepath` from §3.1, `<Router>` accepts a
`mode` prop:

- `mode="history"` (default) — clean URLs via History API. Standard
  setup; requires the server to wildcard-route to the page handler.
- `mode="hash"` — hash-based URLs (`/#/dashboard`). Useful for static
  hosts (GitHub Pages, S3) where you can't configure URL rewrites.
  All `<Route path>` matching happens against `window.location.hash`
  with the leading `#/` stripped.

Hash mode is opt-in for completeness — without it, AbsoluteJS would be
"the multi-framework meta-framework that doesn't work on static hosts
for Svelte SPAs". With it, the answer is "if you want hash routing, set
`mode='hash'`".

### 3.3 `<Route>` — declarative path matcher (uses snippets)

```svelte
<Route path="/dashboard">
  {#snippet content()}
    <h1>Dashboard</h1>
  {/snippet}
</Route>

<Route path="/settings/:tab">
  {#snippet content(params)}
    <SettingsPanel tab={params.tab} />
  {/snippet}
</Route>
```

Props:
- `path: string` — pattern with `:param` and `*` wildcards.
- `exact?: boolean` — default `true` for paths without a trailing
  wildcard.
- `content` snippet receives typed `params` (Svelte 5 snippet API).

**Why snippets and not slot props?** Slot props (`<Route let:params>`)
are Svelte 4 syntax; they still work in Svelte 5 but are considered
legacy. The Svelte team has signaled slots will be deprecated and
removed in a future major (likely 6 or 7). Snippets are Svelte 5's
canonical replacement and what the framework will keep long-term. We
ship snippets so the API outlives a slots-vs-snippets migration cycle.

**Match priority (specificity ranking):**
1. Longest static prefix wins (`/users/me` beats `/users/:id`)
2. Then most static segments (`/a/b/:c` beats `/a/:b/:c`)
3. Then declaration order (tie-breaker)

This matches React Router v6+, Vue Router, Angular Router, and
SvelteKit's internal matcher. svelte-routing uses "first declared wins"
which is a footgun — specificity ranking means users don't have to
manually order routes by specificity.

### 3.4 `<Link>` — client-side navigation anchor

```svelte
<Link to="/settings">Settings</Link>
<Link to="/profile" prefetch="viewport">Profile</Link>
<Link to="/login" replaceState>Log in</Link>
```

Renders a real `<a href>` so progressive enhancement works (no JS →
plain navigation still works). The click handler intercepts and calls
`goto()` instead of letting the browser do a full page load.

Props:
- `to: string` — destination URL (relative or absolute).
- `replaceState?: boolean` — use `history.replaceState` instead of
  `pushState`. Same name as SvelteKit's `goto` option.
- `prefetch?: 'hover' | 'viewport' | 'none'` — default `'hover'`.
  - `'hover'`: on `pointerenter`, start a `fetch()` of the destination.
  - `'viewport'`: prefetch when link enters the viewport.
  - `'none'`: no prefetch.
- `keepFocus?: boolean`, `noScroll?: boolean` — same as `goto()`'s
  options.
- All standard `<a>` attributes pass through (`class`, `aria-*`,
  `target`, `download`, etc.).

Behavior:
- Internal same-origin URLs: client-side navigation via `goto()`.
- External URLs, `target="_blank"`, `download`, modifier-key clicks
  (Ctrl/Cmd/Shift): fall through to browser default — no interception.

**Why a component and not `<a>` interception?** Matches every other
explicit AbsoluteJS-shipped component (`<Head>`, `<Image>`,
`<StreamSlot>`, etc.). Explicit > implicit: `<Link to="/x">` clearly
means "client-side nav"; plain `<a href="/x">` clearly means "full page
nav". This is the React (`react-router-dom`'s `<Link>`), Vue
(`vue-router`'s `<RouterLink>`), and svelte-routing convention; we
deviate from SvelteKit's `<a>`-interception model deliberately.

The cost of deviation: a SvelteKit user porting to AbsoluteJS has to
swap raw `<a>` for `<Link>` (~5 minutes of find-and-replace). Every
other primitive (`goto`, `page`, `pushState`, `replaceState`) carries
over unchanged.

### 3.5 `goto(url, options?)` — programmatic navigation

```ts
import { goto } from "@absolutejs/absolute/svelte/router";

await goto("/settings");
await goto("/login", { replaceState: true });
await goto("/profile", { invalidateAll: true });
```

**Name matches SvelteKit's `goto` from `$app/navigation`.** A user
porting from SvelteKit to AbsoluteJS doesn't relearn this primitive.

Options:
- `replaceState?: boolean` — use `history.replaceState` instead of
  `pushState`. Same name as SvelteKit's option.
- `keepFocus?: boolean` — don't reset focus to body on navigate.
- `noScroll?: boolean` — don't scroll to top.
- `state?: any` — value attached to `history.state`.

Returns a Promise that resolves after the route transition completes
(useful for tests + sequencing animations). Triggers View Transitions
when `document.startViewTransition` is available.

### 3.6 `page` — reactive route state

```svelte
<script lang="ts">
  import { page } from "@absolutejs/absolute/svelte/router";
</script>

<p>Current path: {page.url.pathname}</p>
{#if page.url.pathname === "/dashboard"}
  <ActiveLink />
{/if}
<p>Tab: {page.params.tab}</p>
```

**Name and shape match SvelteKit's `page` from `$app/state`.**
SvelteKit shipped `page` as a Svelte 5 rune-backed reactive state
object (replacing the older `$page` store from `$app/stores`). We mirror
that shape:

- `page.url: URL` — the current URL as a parsed `URL` object. Access
  `pathname`, `search`, `hash`, `searchParams` (parsed
  `URLSearchParams`), etc. directly.
- `page.params: Record<string, string>` — parameters extracted from the
  active `<Route>` pattern.
- `page.state: any` — `history.state` for the current entry (set via
  `goto()`'s `state` option or `pushState()` / `replaceState()`).

Backed by `$state` under the hood so direct property access in
templates re-renders. Matches SvelteKit's reactive-state ergonomics.

### 3.7 `pushState(url, state)` and `replaceState(url, state)` — shallow routing

```ts
import { pushState, replaceState } from "@absolutejs/absolute/svelte/router";

// Open a modal at /photos/42 without re-rendering the page tree
pushState("/photos/42", { modal: "photo", id: 42 });
```

**Names match SvelteKit's shallow routing primitives.** Updates the URL
bar and `page.state` without re-running route matching. Useful for
modals, drawers, and other ephemeral UI that wants a URL but shouldn't
swap the active `<Route>`.

### 3.8 Sub-export shape

```json
"./svelte/router": {
  "browser": "./dist/svelte/router/browser.js",
  "import": "./dist/svelte/router/index.js",
  "types": "./dist/src/svelte/router/index.d.ts"
}
```

The compiled output ships as plain JS/ESM (compiled from `.svelte` source
during `bun run build`). No `.svelte` files ever leave AbsoluteJS's repo
in published form — that's what makes Bun consumers Just Work.

## 4. SSR + hydration semantics

The contract that makes this work end-to-end:

1. **Elysia route**: `app.get('/dashboard/*', handler)` (wildcard pattern).
2. **Page handler call**: user passes `props: { url: ctx.request.url }`.
3. **Server render**: page receives `url` prop, wraps content in
   `<Router url={url}>`. The `<Route>` blocks match against `url`. Output
   HTML reflects the matched route. `page.url` is initialized from `url`.
4. **Client hydration**: same page is rendered, `<Router>` reads
   `window.location` (because `url` is undefined on the client). It
   matches the same path → matches the same `<Route>` → DOM matches
   server output → no hydration mismatch. `page.url` is initialized
   from `window.location`.
5. **Subsequent navigation**: `<Link>` clicks are intercepted and call
   `goto()`. `goto()` updates `page.url` and `page.params`, which
   re-renders the matching `<Route>`. `history.pushState` updates the
   URL bar. View Transitions wrap the swap when supported. Plain
   `<a href>` continues to do full-page navigation — no implicit
   interception.
6. **Refresh on sub-route**: hits the wildcard Elysia route again, server
   renders the matching sub-route, identical DOM, hydration succeeds.

The key invariant: **same logic on both sides**, just different sources for
"current URL". This is exactly how `react-router-dom`'s `<StaticRouter>` /
`<BrowserRouter>` and `vue-router`'s memory/web history split work.

## 5. View Transitions

When `document.startViewTransition` is available, `goto()` wraps the
location change inside it:

```ts
const goto = async (url: string, options?: GotoOptions) => {
  if (document.startViewTransition) {
    await document.startViewTransition(() => updateLocation(url, options)).finished;
  } else {
    updateLocation(url, options);
  }
};
```

Carry the same pattern from Angular's HMR transition handling
(`src/dev/client/` already uses View Transitions for component swaps).
Default-on. CSS escape via `view-transition-name` properties on user
elements. Reduced-motion users automatically get instant swaps via the
browser's built-in handling of `prefers-reduced-motion`.

## 6. Prefetching

Configured via `<Link prefetch="...">` (see §3.4). Three modes:

- `prefetch="hover"` (default): on `pointerenter`, start a `fetch()` of
  the destination. Cache response in a Map keyed by URL. Clicking the
  link consumes the cached response if it's ready; otherwise falls
  through to a fresh fetch.
- `prefetch="viewport"`: register an `IntersectionObserver` on mount;
  when the link enters the viewport, prefetch.
- `prefetch="none"`: disable prefetch for this link.

Cap the cache at N entries (default 16) with LRU eviction. Clear the
cache entry for a URL on `goto(url)` (it's now consumed). Debounce
`pointerenter` (250ms) so glancing across links doesn't trigger fetches
for every link in the cursor's path. Auto-skip prefetch when the user
has `prefers-reduced-data` set or is on a slow connection
(`navigator.connection.saveData`).

## 7. Module layout

```
src/svelte/router/
├── Router.svelte              # context provider + nested-router
│                              # basepath stacking + location/page init
├── Route.svelte               # path matcher (snippet-based, generic
│                              # over Path literal for params inference)
├── Link.svelte                # client-side navigation anchor
│                              # (renders <a href>, intercepts click)
├── goto.ts                    # programmatic navigation + history glue
├── pushState.ts               # shallow routing (pushState/replaceState)
├── page.svelte.ts             # `page` rune (Svelte 5 $state-backed
│                              # reactive route state)
├── matchPath.ts               # path pattern → params extraction with
│                              # specificity ranking
├── extractParams.ts           # template-literal type helper for
│                              # <Route> generic param inference
├── prefetchCache.ts           # LRU map + fetch coordination + hover
│                              # debouncing
├── viewTransitions.ts         # startViewTransition wrapper
├── hashMode.ts                # hash routing helpers (used when
│                              # <Router mode="hash">)
├── index.ts                   # server entry — re-exports
└── browser.ts                 # client entry — re-exports
```

`types/svelteRouter.ts` for the public surface types (`GotoOptions`,
`PageState`, `LinkProps`, `ExtractRouteParams`, etc.).

## 8. Build pipeline integration

The router lives in `src/svelte/router/`. During `bun run build`:

1. The existing `compileSvelte` pass picks up `src/svelte/router/*.svelte`
   along with the rest of the framework's Svelte sources.
2. Compiled outputs land in `dist/svelte/router/{Router.js, Route.js,
   Link.js, ...}`.
3. `index.ts` re-exports the compiled components by JS path.
4. `package.json` `exports` adds `./svelte/router` mapping to the dist
   output.

No new build phase needed — the router is just more Svelte source files
compiled by the existing pipeline.

The user side: `bun add @absolutejs/absolute` already gets them the
router via the sub-export. No additional package needed.

## 9. Phased rollout

**Phase 1 — full v1 router** (this plan, single shippable scope).
- `<Router>` (with `mode` and nested basepath), `<Route>` (snippet-based
  with type-inferred `params`), `<Link>`.
- `goto()`, `page` rune, `pushState()`, `replaceState()`.
- SSR + hydration via URL passthrough.
- Path matching with specificity ranking, params, optional params,
  wildcards.
- Hash mode (`<Router mode="hash">`).
- View Transitions on `goto()`.
- Prefetch (hover + viewport) via `<Link prefetch="...">`.
- Documented in spa-example.

**Phase 2 — stretch features** (separate follow-up).
- `<Route>` `loader` prop for data fetching (parallels react-router v7
  `loader` and SvelteKit `+page.server.ts` patterns).
- Scroll restoration on back/forward (manual `scrollRestoration`).
- Route guards (`<Route guard={(page) => ...}>` — return `false` or a
  redirect URL).

Phase 1 is the v1 release. Phase 2 items are additive and don't block
shipping.

## 10. Test plan

- **Unit**: `matchPath` with static/param/wildcard patterns, edge cases
  (trailing slash, query strings, hash, optional params).
- **Type tests**: assert `ExtractRouteParams<P>` produces the expected
  shape for the standard pattern matrix (static, single `:param`,
  multiple `:param`s, optional `:param?`, wildcard, mixed).
- **SSR**: render `<Router url="/dashboard/settings">` server-side, assert
  the right `<Route>` content is in output HTML.
- **Hydration**: render server-side, hydrate client-side, assert no
  hydration mismatch, assert `page.url.pathname` matches.
- **Navigation**: click a `<Link>`, assert `pushState` called, assert
  active `<Route>` swapped, assert `page.url` updated.
- **Nested Router**: assert basepath stacking works
  (`<Router basepath="/portal"><Router basepath="/admin">`).
- **Hash mode**: assert `<Router mode="hash">` matches against
  `window.location.hash`.
- **Refresh-mid-route**: simulate fresh server render at
  `/dashboard/foo`, assert correct route is matched.
- **E2E (in spa-example)**: full Playwright run hitting all three
  sub-routes with refresh + navigate flows.

## 11. Resolved design decisions

The five questions originally open in this section have all been resolved:

### 11.1 Match-priority — RESOLVED: specificity ranking
Longest static prefix → most static segments → declaration order as
tie-breaker. Matches React Router v6+, Vue Router, Angular Router, and
SvelteKit's internal matcher. svelte-routing's "first declared wins" is
explicitly rejected as a footgun.

### 11.2 `<Route>` API — RESOLVED: snippets
Svelte 5 snippets, not Svelte 4 slot props. Slots are legacy and the
Svelte team has signaled they'll be deprecated in a future major. The
API outlives a slots-vs-snippets migration cycle.

### 11.3 Search params — RESOLVED: parsed `URLSearchParams` in `page.url`
`page.url` is a real `URL` object, so `page.url.searchParams` is
already a `URLSearchParams` for free. No extra API needed.

### 11.4 Hash routing — RESOLVED: ship in v1 via `<Router mode="hash">`
Default is `mode="history"`; hash mode is a one-prop opt-in. Lets
AbsoluteJS Svelte SPAs deploy to GitHub Pages / S3 without server URL
rewriting. "Fully valid Svelte routing story" was the goal here — Rich
Harris doesn't get to point at a missing primitive.

### 11.5 SvelteKit migration story — RESOLVED: deliberately align
Match SvelteKit's `$app/navigation` and `$app/state` API names where we
have an analog: `goto()`, `page` rune, `pushState()`, `replaceState()`.
Where SvelteKit doesn't have an analog (because it uses filesystem
routing), we use our own names: `<Router>`, `<Route>`. This minimizes
the mental model shift for users moving from SvelteKit to AbsoluteJS or
keeping an option to migrate later.

## 12. Additional v1 inclusions

### 12.1 Type-inferred `params` from path literal
`<Route>` is a Svelte 5 generic component over its `path` literal:

```svelte
<script lang="ts" generics="Path extends string">
  import type { Snippet } from 'svelte';
  import type { ExtractRouteParams } from './extractParams';

  let { path, content }: {
    path: Path;
    content: Snippet<[ExtractRouteParams<Path>]>;
  } = $props();
</script>
```

`ExtractRouteParams<P>` is a template-literal type that walks `P` and
extracts `:param` names into a `Record<param, string>`. Examples:

| Path pattern | Inferred params type |
|---|---|
| `/dashboard` | `Record<string, never>` |
| `/users/:id` | `{ id: string }` |
| `/users/:id/posts/:postId` | `{ id: string; postId: string }` |
| `/files/*` | `{ wildcard: string }` |
| `/users/:id?` | `{ id: string \| undefined }` |

Edge cases handled in v1: required `:param`, optional `:param?`,
wildcard `*` (typed as `wildcard`), repeated params (rejected — same
name twice in the path is a type error). The implementation lives in
`extractParams.ts` as a pure type helper plus a runtime extractor that
mirrors the type semantics.

### 12.2 Nested `<Router>` with basepath stacking
Nested `<Router>` blocks work via `basepath` inheritance:

```svelte
<Router basepath="/portal" {url}>
  <!-- /portal/admin/* via the inner Router's basepath stack -->
  <Router basepath="/admin">
    <Route path="/users">
      {#snippet content()}<UsersPage />{/snippet}
    </Route>
  </Router>
</Router>
```

The inner `<Router>` matches against `/portal/admin/users` via
basepath concatenation. Useful for embeddable Svelte SPA fragments
shipped as packages (a vendor ships a `<UserAdmin>` component that
contains its own `<Router basepath="/users">` and the consumer mounts
it under `<Router basepath="/admin">`).

`page.url` in the inner context still reflects the full URL; only
`<Route path>` matching is scoped by the basepath stack.

### 12.3 Default click-interception scope
*Resolved by switching to a `<Link>` component (§3.4).* `<Link>`
explicitly intercepts its own click; plain `<a>` is never intercepted.
No global delegation, no scope question.

## 13. Success criteria

- Spa-example's `/svelte` page demonstrates SPA navigation across three
  sub-routes (Home / Settings / Profile) via `<Router>` + `<Route>` +
  `<Link>`.
- Refresh on `/svelte/settings` SSRs the Settings view.
- Click navigation between sub-routes preserves layout state (sidebar,
  click counter).
- `<Route path="/users/:id">` snippet's `params` argument is typed
  as `{ id: string }` without any explicit annotation.
- Nested `<Router>` with basepath stacking matches paths correctly.
- `bun run typecheck` and the example test suite stay green.
- Bundle size of the router (gzipped) is under 5KB.
- Zero `.svelte` files leak into published `dist/`.
- A user porting from SvelteKit to AbsoluteJS finds the routing
  primitives recognizable: `goto`, `page`, `pushState`, `replaceState`.

## 14. Risks

- **Svelte 5 → 6 transition.** Svelte's API isn't quite frozen.
  Mitigation: keep the router small and Svelte-runes-friendly (already
  in scope for v1) — small surface is small upgrade work.
- **Path-matching edge cases.** Easy to ship subtle bugs. Mitigation:
  unit tests on `matchPath` are non-optional, with parity assertions
  between the runtime extractor and the `ExtractRouteParams` type.
- **Type-inference complexity** (§12.1). Template-literal types for
  paths are intricate; getting one edge case wrong breaks consumer
  type-checks. Mitigation: dedicated type-test suite asserting
  inferred `params` types for the standard pattern matrix.
- **Hydration mismatches** if server URL parsing diverges from client
  URL parsing. Mitigation: share `URL`-based parsing between
  `Router.svelte`'s SSR branch and the client navigate path.
- **Prefetch DDoS.** A page with many links on hover could fire too
  many fetches. Mitigation: LRU cache + cap N + debounce
  `pointerenter` (250ms) so glancing across links doesn't trigger
  fetches for every link in the cursor's path.
- **Nested `<Router>` basepath bugs.** Concatenation logic has to
  handle leading/trailing slashes correctly to avoid `/portal//admin`
  or `/portaladmin` glitches. Mitigation: a single `joinBasepath`
  helper used by every consumer; unit-tested against a slash-edge-case
  matrix.

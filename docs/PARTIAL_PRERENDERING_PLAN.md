# Partial prerendering

Status: Phase 1 implemented (React and Svelte). Phases 2–4 planned.

## What exists today

Two features already exist. Before this work they didn't combine: a page was
either fully pre-rendered or fully dynamic.

**Prerendering and ISR** (`src/core/prerender.ts`)

- With `static: { routes, revalidate }` set, `absolute start` and
  `absolute compile` start the bundled server and fetch each route.
  `routes: 'all'` crawls internal links from `/`.
- Each page is written to `<outdir>/_prerendered/<route>.html`, with
  `<route>.meta` (the render timestamp) and, under `secureHeaders()`,
  `<route>.nonce` (the nonce that render used).
- The `prerendered-pages` plugin in `src/core/prepare.ts` (production only)
  answers `onRequest` from that map, before any route handler runs.
- When `revalidate` is set and a page is older than the interval, the plugin
  serves the stale page. It also calls `rerenderRoute`, which fetches the
  route over loopback with `X-Absolute-Prerender-Bypass: 1` and rewrites the
  file.
- `prerenderNonce.ts` swaps the stored nonce for the request's nonce on
  `<script>`/`<style>` at serve time.

**Streaming slots** (`src/utils/streamingSlots.ts`, `src/core/responseEnhancers.ts`)

- These primitives register a `StreamingSlot` (`{ id, resolve, fallbackHtml,
  errorHtml, timeoutMs }`) through the global registrar
  (`streamingSlotRegistrar.ts`) while the page renders:
  - React `StreamSlot`/`SuspenseSlot`
  - Svelte `StreamSlot`/`AwaitSlot` and `<!-- absolute:stream -->` `{#await}`
    lowering
  - Vue `StreamSlot`/`SuspenseSlot`
  - Angular `StreamSlot`/`DeferSlot` and `@defer` lowering
- The registry is an AsyncLocalStorage (`streamingSlotRegistry.ts`). Page
  handlers turn on collection with `collectStreamingSlots: true`, which runs
  the render inside `withRegisteredStreamingSlots`.
- `appendStreamingSlotPatchesToStream` injects the swap runtime
  (`src/client/streamSwap.ts`) and resolves every slot concurrently with the
  page stream. It writes each result as a
  `<script>__ABS_SLOT_ENQUEUE__(id, payload)</script>` patch before
  `</body></html>`, using the policy's timeouts and size limits. Patches
  carry the request's nonce (`cspNonceRef.ts`).
- The placeholder is `<div id data-absolute-slot>` holding the fallback, so
  slot ids are stable, developer-chosen strings. Svelte's lowered await
  slots use `absolute-svelte-await-N`, numbered per component file.
- HTMX has no streaming slot. Its equivalent is a fragment the page fetches
  after load (`hx-get` with `hx-trigger="load"`).

Before this work, pre-rendering a page with streaming slots resolved every
slot at build time and baked it into the HTML. Rendering on demand resolved
every slot per request, and the server re-rendered the whole page each time.

## Goal

Pre-render a page's static shell at build time (or on revalidate), serve it
from the cache before the route handler runs, and render only its dynamic
holes per request. Stream the holes into the cached shell with the existing
swap runtime and the request's CSP nonce.

## Design

### Marking dynamic holes

- A slot is **dynamic** when it has `dynamic: true`. That's a field on
  `StreamingSlot` and a prop on every slot primitive. In Svelte it's also a
  directive variant, `<!-- absolute:stream dynamic -->`.
- Everything else is static. A static slot on a pre-rendered page resolves
  once, at capture, and its patch is stored in the shell. That's exactly the
  current behaviour, so existing pre-rendered pages don't change.
- A page has no partial-prerender flag. A route listed in `static.routes`
  becomes a partial shell as soon as its render registers a dynamic slot.
- **How the build knows.** It doesn't analyse source. The capture render
  reports the dynamic slots it registered in a response header
  (`X-Absolute-Partial-Holes`, URI-encoded ids). The capture stores them
  next to the shell as `<route>.holes`.
- **Slots that read the request.** Phase 1 relies on the explicit flag. The
  developer has to mark anything that reads cookies, headers or the session.
  Most code reads the request in the route handler and passes it to the slot
  through props or a closure, and nothing can detect that at runtime. Phase 2
  adds detection for the case that can be detected: during capture, a static
  slot's resolver runs inside a tracking scope. If it calls a request-scoped
  accessor (`getCurrentAbsoluteRequest`, the Elysia context getters
  AbsoluteJS wraps, `cookies()`-style helpers), the build:
  - treats the slot as dynamic,
  - drops its patch from the shell, and
  - logs a warning that names the slot, so the developer adds the flag.

  CSP nonce reads are excluded, because every patch reads one.
- **What about hydration?** The shell's hydration props
  (`__INITIAL_PROPS__`, Svelte/Vue state) are captured with it. Per-user data
  must reach the page through dynamic holes, never through page props. This
  is documented as the contract for partial pages.

### Shell capture

- `prerenderRoute` and `rerenderRoute` send `X-Absolute-Partial-Shell: 1`.
  `withRegisteredStreamingSlots` sees that header on the current request
  (`requestContext`) and does three things:
  - Static slots stream and patch into the page as usual.
  - Dynamic slots are left out of resolution, so their placeholders keep the
    fallback. Their resolvers never run at build time, so a slow or
    request-dependent hole costs the build nothing.
  - The swap runtime is injected even when every slot is dynamic, so the
    request-time patches have a runtime to land in.
- The captured file is stored with the same layout as before, plus
  `<route>.holes` (one encoded id per line). A page with no dynamic slot
  gets no `.holes` file and is served exactly as before.
- **Per locale.** The i18n work is being designed in parallel. When it lands,
  the shell key becomes `(route, locale)`: `_prerendered/<locale>/<route>.html`
  and its sidecars, captured once per configured locale. The serving plugin
  picks the locale the same way the i18n router does (path prefix first,
  then the negotiated cookie or header). Locale stays part of the cache key,
  never a hole, because nearly all of a localized shell differs between
  locales.
- **ETag and 304.** The composite document is per-request, because its holes
  are, so it can't be revalidated as a whole. Phase 1 sends
  `Cache-Control: private, no-cache`, no `ETag`, and never answers 304.
  Shared caches must not store it. Phase 3's edge mode serves the shell by
  itself, with a strong content-hash `ETag` (the hash is computed once at
  capture and stored in `<route>.etag`). It gets a 304 on `If-None-Match`
  and `Cache-Control: public, no-cache` (or `s-maxage` set to the revalidate
  interval). The holes then come from a separate request that is never
  cached.

### Request time

In the `prerendered-pages` plugin, for a GET whose route has holes:

1. Read the shell. Under `secureHeaders()`, `servePrerenderedPage` restamps
   it with this request's nonce, so the CSP behaviour of fully pre-rendered
   pages carries over unchanged. Split the shell before its closing
   `</body></html>`.
2. Respond at once with a stream that starts with the shell head. Its
   headers are the security headers, `text/html`, `private, no-cache` and
   `x-absolute-partial-prerender: shell`. Time to first byte is the cost of
   a file read, independent of the route handler and of every slot.
3. In the same process, render the route through the app (`app.handle`,
   captured in the plugin's `onStart`):
   - The request is a copy of the visitor's, with their cookies and headers
     and the bypass header.
   - It runs inside `collectPartialHoles`, an AsyncLocalStorage sink shared
     across bundles via `Symbol.for`.
   - `withRegisteredStreamingSlots` sees the sink. It hands over the dynamic
     slots the page registered, cancels the page body and returns 204.
4. Keep the slots whose ids are in `<route>.holes` and resolve them with
   `appendStreamingSlotPatchesToStream`, which applies the same policy,
   timeouts, size limits, error HTML and metrics as normal streaming:
   - It runs under the visitor's request context, so a resolver that reads
     the request sees the visitor's.
   - Each patch is written with the request's nonce, the same nonce the
     shell was restamped with.
   - A hole that doesn't resolve keeps its fallback.
   - A slot registered at request time but missing from the shell has no
     placeholder and is ignored.
5. Append the shell's closing tags.

Failure modes:

- If the holes render throws or redirects, the shell is already sent and
  keeps its fallbacks, and the error is logged.
- Partial pages can't redirect or set a status after the shell. Auth
  redirects belong in a client-side check or on routes that aren't
  pre-rendered. This is documented.
- If the plugin has no app handle (the app was never started, as with
  `app.handle()` in tests), the route renders fully.

Phase 1 cost: the holes render still runs the route handler and the page
render to obtain the slot closures. That work is off the first-byte path but
still CPU. Phase 2 can cut it:

- The page handler, in hole mode, aborts the framework render as soon as
  every listed hole has registered. React and Svelte register slots while
  rendering the shell, before any Suspense content.
- A dynamic slot can be declared as a route-level resolver that needs no page
  render at all: `static.holes: { '/dashboard': { cart: (request) => … } }`.

### Invalidation

- **Revalidate interval.** This reuses ISR. A stale shell is still served
  (holes per request as usual) and triggers `rerenderRoute`, which recaptures
  the shell and rewrites `.html`, `.nonce`, `.holes` and `.meta` together.
  Holes are never cached, so `revalidate` only controls how fresh the
  **static** parts are.
- **On-demand revalidation** (Phase 2). AbsoluteJS has no API for this
  today. Add `revalidatePath(route)` (and `revalidateAll()`), exported from
  `@absolutejs/absolute`, that call `rerenderRoute` for pre-rendered routes
  and dedupe through the same `rerendering` set. Writes go to a temp file
  plus a rename, so a request never reads a half-written shell. Phase 2 also
  exposes an optional authenticated `POST /_absolute/revalidate` endpoint
  (`static.revalidateToken`) for CMS webhooks.
- **Deploys.** A new build re-captures every shell. Shells reference hashed
  assets, so a stale shell never outlives its deploy.
- **Dev.** Dev has no pre-render cache. Dynamic slots stream like any slot,
  so the page renders fully on every request, as before.

### Frameworks

| Framework | Hole primitive | Phase |
| --- | --- | --- |
| React | `StreamSlot`/`SuspenseSlot` `dynamic` | 1 (done) |
| Svelte | `StreamSlot`/`AwaitSlot` `dynamic`, `<!-- absolute:stream dynamic -->` | 1 (done) |
| Vue | `StreamSlot`/`SuspenseSlot` `dynamic` | 2 |
| Angular | `StreamSlot`/`DeferSlot` `dynamic`, `@defer` lowering with a `dynamic` marker | 2 |
| HTML | islands only; a dynamic island is Phase 4 | 4 |
| HTMX | deferred fragment fetch (below) | 3 |

Vue and Angular go through the same `withRegisteredStreamingSlots`. For them,
Phase 2 is mostly about passing the prop through and adding tests:

- Vue's `SuspenseSlot` patch payload (`kind: 'vue-suspense'`) is applied by
  its own consumer after hydration.
- Angular's `@defer` lowering has to carry the flag into the generated
  `DeferSlot`.

**HTMX.** HTMX pages don't use streaming slots. A hole there is an element
with `hx-get="/fragment" hx-trigger="load" hx-swap="outerHTML"` around its
fallback, which is already how HTMX defers content. The shell is pre-rendered
with that element in it. The fragment route is an ordinary dynamic route,
never pre-rendered. Phase 3 adds:

- a small helper that renders that element with a stable id, so authors
  don't hand-write it;
- documentation that HTMX partial pages need nothing from the server-side
  hole machinery;
- `X-Absolute-Partial-Shell` handling, so the fragment's fallback is used
  during capture.

The cost is a second round trip in place of an in-document stream, which is
the HTMX model.

## Phases and exit criteria

**Phase 1: React and Svelte, in-process holes (done)**

- `dynamic` on `StreamingSlot`, React `StreamSlot`/`SuspenseSlot`, Svelte
  `StreamSlot`/`AwaitSlot` and `<!-- absolute:stream dynamic -->`.
- Shell capture in `withRegisteredStreamingSlots`; `<route>.holes` written by
  `prerenderRoute`/`rerenderRoute`.
- Shell serving with in-process hole streaming in the `prerendered-pages`
  plugin, with the nonce carried through.
- Exit criteria, all met:
  - Unit tests: capture leaves dynamic slots as fallbacks, resolves static
    ones and lists the holes. Serving sends the shell before a slow hole.
    Each request gets its own holes. Static resolvers don't re-run. Patches
    and shell carry the request nonce. Svelte await and StreamSlot holes
    stream.
  - Integration test under `absolute start` with `secureHeaders()`: TTFB of a
    partial route under 250 ms (measured 3 ms) while the full SSR of the same
    route takes 800 ms or more to first byte. Holes are per-cookie. ISR
    recapture keeps the holes.
  - E2E against a packed tarball in a scaffolded app.

**Phase 2: Vue and Angular, on-demand revalidation, cheaper holes**

- `dynamic` for Vue `StreamSlot`/`SuspenseSlot` and Angular
  `StreamSlot`/`DeferSlot` plus `@defer` lowering.
- `revalidatePath`/`revalidateAll`, atomic shell writes and an optional
  webhook endpoint.
- Request-read detection during capture, with a build warning.
- Hole-mode render abort once the listed holes have registered.
- Exit criteria:
  - Vue and Angular integration tests matching Phase 1's.
  - A `revalidatePath` test showing the next request gets the new static
    content while holes are unaffected.
  - A capture warning test.
  - A benchmark showing hole-mode CPU per request below a full render.

**Phase 3: Edge or CDN mode and HTMX**

- `static.partial: { edge: true }`: the shell is served by itself with a
  strong `ETag`, a 304 and a public cache policy. Holes come from
  `GET <route>?__absolute_holes` (never cached). That response is a
  `text/html` stream of patch scripts appended by a tiny loader in the shell.
- An HTMX hole helper, and capture handling for it.
- Exit criteria:
  - A shell request returns 304 on a matching `If-None-Match`.
  - The holes endpoint returns only patches, and they carry a nonce valid
    for the shell's policy. That needs a `strict-dynamic` loader, or a hole
    response with its own policy.
  - An HTMX partial page e2e test.

**Phase 4: Per-locale shells and islands**

- When i18n lands, shells are keyed by locale (see Shell capture).
- A dynamic island on an HTML or HTMX page is rendered as a hole: an
  `Island` with `dynamic` server-renders per request into the shell.
- Exit criteria: per-locale capture and serving tests, and a dynamic island
  test on an HTML page.

## Phase 1 API

```tsx
// React
<StreamSlot dynamic id="greeting" fallbackHtml="<p>…</p>" resolve={() => greet(user)} />
<SuspenseSlot dynamic id="cart" fallback={<Skeleton />} resolve={() => loadCart(user)}>
	{(cart) => <Cart cart={cart} />}
</SuspenseSlot>
```

```svelte
<StreamSlot dynamic id="greeting" fallbackHtml="<p>…</p>" resolve={greet} />

<!-- absolute:stream dynamic -->
{#await loadCart(user)}
	<p>Loading…</p>
{:then cart}
	<p>{cart.items.length} items</p>
{/await}
```

```ts
// absolute.config.ts — unchanged; a listed route with a dynamic slot is partial.
export default defineConfig({ static: { routes: ['/dashboard'], revalidate: 60 } });
// The page must collect slots:
handleReactPageRequest({ collectStreamingSlots: true, Page, index, props });
```

Internal: `PARTIAL_SHELL_HEADER`, `PARTIAL_HOLES_HEADER`,
`collectPartialHoles`, `readPartialHoles`, `writePartialHoles`
(`src/core/partialPrerender.ts`) and `servePartialPrerender`
(`src/core/partialPrerenderServe.ts`).

## Known limits (Phase 1)

- The holes render runs the route handler and page render each request (off
  the first-byte path).
- No status or redirect after the shell is sent.
- The shell's hydration props are captured at build time.
- Svelte lowered await-slot ids are numbered per component file. Two
  components that each stream an `{#await}` on one page share an id. This
  predates this work and matters more now, because ids key the holes.
- `<link rel="modulepreload" nonce>` isn't restamped by `prerenderNonce.ts`
  (only `<script>` and `<style>`). This predates this work and affects fully
  pre-rendered pages too.

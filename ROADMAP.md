# AbsoluteJS Roadmap — Next.js Feature Parity

Features missing from AbsoluteJS that Next.js provides, ordered by priority. Each entry includes what Next.js does, what AbsoluteJS currently has, and what needs to be built.

---

## 3. P1 — Client-Side Navigation / SPA Mode with `<Link>`

**What Next.js does:**
`<Link>` component that intercepts clicks and does client-side navigation — fetches only the new page's data/RSC payload, swaps the content, and preserves layout state (scroll position, open menus, form inputs). Prefetches linked pages on hover or when they enter the viewport. This is what makes Next.js apps feel like SPAs even though they're server-rendered.

**What AbsoluteJS has today:**
Plain `<a>` tags. Every navigation is a full page load — the browser tears down the entire DOM, re-requests the HTML, and re-hydrates from scratch. Shared UI like navbars and sidebars re-mount every time.

**Why this matters:**
Without client-side navigation, layouts are just a component pattern (wrap your page in a shared component — users can do this today). WITH client-side navigation, layouts become persistent — the navbar stays mounted, sidebar scroll position is preserved, and only the page content swaps. This is the single feature that turns a server-rendered app into an SPA experience.

**Architecture: One shared navigation module, thin framework wrappers**

React Router and similar client-side routers can't help here — they swap client-side components, but AbsoluteJS pages are server-rendered. The navigation module needs to fetch server-rendered HTML and swap it into the DOM. This is fundamentally framework-agnostic — the DOM swap logic is identical whether the page is React, Svelte, Vue, or Angular. So the right design is:

1. **One shared navigation module** (`navigate.ts`) that handles all the core logic: intercept clicks, fetch partial HTML, swap DOM content, manage history, prefetch. This runs as plain JS on every page regardless of framework.
2. **Thin per-framework `<Link>` wrappers** that just render an `<a>` tag with the right attributes. The shared module picks up all `<a>` tags with a `data-link` attribute (or all internal links by default) — the framework components are just ergonomic sugar so users don't have to remember the attribute.

**What needs to be built:**

*Shared navigation module (`navigate.ts`):*
- Intercept clicks on internal `<a>` tags (skip external links, `target="_blank"`, modifier keys)
- `fetch()` the URL with an `X-AbsoluteJS-Nav: partial` header
- Receive partial HTML (just the `<main>` content, not the full document)
- Swap the `<main>` innerHTML with the new content
- Load any new CSS before swapping to avoid FOUC
- `history.pushState()` on navigate, handle `popstate` for back/forward
- Hydrate the new content after swap (call the framework's hydration entry point)
- View Transitions API for smooth animated swaps (already used in Angular HMR)

*Prefetching:*
- On `mouseenter` (default) — prefetch the page so it's ready on click
- On viewport intersection (opt-in via `data-prefetch="viewport"`) — for visible links
- `data-prefetch="none"` to disable
- Cache prefetched responses in a Map to avoid duplicate fetches
- Smart limits — don't prefetch more than N pages at once

*Server-side partial rendering:*
- An Elysia `onBeforeHandle` hook that checks for the `X-AbsoluteJS-Nav: partial` header
- When present, each framework's page handler skips the outer `<html>/<head>/<body>` shell and returns only the inner page content (the part inside `<main>`)
- Also returns metadata in a response header or JSON wrapper: page title, CSS paths, framework type, hydration entry point

*Per-framework `<Link>` wrappers:*
- React: `<Link href="/about">About</Link>` → renders `<a href="/about">About</a>` with the right attributes. Thin component, no routing logic.
- Svelte: `<Link href="/about">About</Link>` → same thing
- Vue: `<Link href="/about">About</Link>` → same thing
- Angular: `<a absLink href="/about">About</a>` directive → same thing
- All wrappers accept `prefetch` prop (`"hover"` | `"viewport"` | `"none"`)

*Cross-framework navigation:*
- Same-framework navigations: swap `<main>`, hydrate with the same runtime. Fast.
- Cross-framework navigations (React page → Svelte page): need to tear down the old framework's hydration and bootstrap the new one. The partial response includes the framework type so the navigation module knows which hydration to call. May need to swap `<body>` instead of just `<main>` if the framework runtimes conflict.
- Fallback: if cross-framework swap is too complex initially, just do a full page load for cross-framework links. Still use View Transitions for visual continuity.

**Design considerations:**
- Progressive enhancement — the `<Link>` renders a real `<a>` tag with a real `href`. If JS fails, it's a normal link. If the partial fetch errors, fall back to full navigation. No JS-only routes.
- The shared module should be small (<5KB) and loaded on every page as part of the AbsoluteJS client runtime, alongside the HMR client in dev.
- CSS handling: the partial response should include which stylesheets the new page needs. The navigation module loads them before swapping to prevent FOUC. Stylesheets shared between pages stay loaded.
- Scroll behavior: scroll to top on navigation by default, restore scroll position on back/forward via `scrollRestoration: 'manual'`.

**Files likely involved:**
- New: `src/client/navigate.ts` — shared framework-agnostic navigation module (click interception, fetch, DOM swap, history, prefetch, View Transitions)
- New: `src/react/components/Link.tsx` — thin React wrapper
- New: `src/svelte/Link.svelte` — thin Svelte wrapper
- New: `src/vue/Link.vue` — thin Vue wrapper
- New: `src/angular/link.directive.ts` — thin Angular directive
- New: `src/plugins/navigation.ts` — Elysia plugin that detects `X-AbsoluteJS-Nav: partial` header and adjusts response
- Each framework's `pageHandler.ts` — add partial rendering mode that returns only inner content + metadata
- `src/dev/client/hmrClient.ts` — ensure HMR reconnects correctly after client-side navigation

---

## 5. P1 — Out-of-Order Streaming

**What SolidStart does:**
Components stream to the client as they resolve, not in DOM order. If your sidebar data query finishes before your main content query, the sidebar HTML ships first. The browser renders each chunk into the correct DOM position regardless of arrival order. This means the fastest data always appears first — no waterfall where a slow hero section blocks the entire page.

**What AbsoluteJS has today:**
Full streaming SSR via `renderToReadableStream` for all frameworks. But streaming is in-order — the HTML is sent top-to-bottom as React/Svelte/Vue render the component tree. If a component high in the tree is slow (data fetch, heavy computation), everything below it waits.

**Why this matters:**
In a typical dashboard page, you might have:
- A navbar (instant, no data)
- A stats section (slow — aggregation query)
- A recent activity feed (fast — simple query)
- A footer (instant, no data)

With in-order streaming, the activity feed waits for the stats section even though its data is ready. With out-of-order streaming, the navbar, activity feed, and footer arrive immediately while the stats section streams in when its query finishes. The user sees a useful page faster.

**What needs to be built:**

*Server side:*
- Placeholder slots in the HTML — when a component is async/suspended, send a lightweight placeholder `<div id="slot-{id}">` with a loading skeleton or empty space
- As each async component resolves, send an `<template>` or `<script>` block that contains the real HTML and swaps it into the placeholder
- This is how React 18's Suspense streaming works under the hood — `renderToReadableStream` already supports this for React via `<Suspense>` boundaries. The work is extending this pattern to Svelte, Vue, and Angular.

*Per-framework implementation:*
- **React**: Already supports this via `<Suspense>` boundaries with `renderToReadableStream`. Each `<Suspense>` boundary becomes an independent streaming slot. The main work is documenting the pattern and ensuring it works with AbsoluteJS's page handler.
- **Svelte**: Svelte 5 has `{#await}` blocks. The custom `renderToReadableStream` in `src/svelte/renderToReadableStream.ts` needs to support async resolution — when an `{#await}` block is pending, send a placeholder and stream the resolved content later.
- **Vue**: Vue's `<Suspense>` component with `renderToWebStream` can be extended similarly. Each `<Suspense>` boundary becomes a streaming slot.
- **Angular**: Angular's `@defer` blocks are the equivalent. The SSR renderer can send placeholders for `@defer` blocks and stream them in when resolved.

*Client side:*
- A small inline script (sent at the start of the stream) that listens for arriving chunks and swaps them into their placeholder slots
- Pattern: `<script>function $RC(id,html){document.getElementById('slot-'+id).outerHTML=html}</script>`
- Each resolved chunk arrives as: `<script>$RC("stats-section","<div>...real content...</div>")</script>`
- This script is ~200 bytes and makes out-of-order streaming work without any framework JS loaded yet

*Integration with islands:*
- Islands with `hydrate="idle"` or `hydrate="visible"` are natural candidates for out-of-order streaming — send the placeholder, stream the SSR'd HTML when ready, hydrate later based on the directive
- This creates a smooth pipeline: placeholder → streamed HTML (visible but not interactive) → hydrated (interactive)

**Design considerations:**
- Fallback content for each slot (loading skeleton, spinner, or empty space) should be configurable per-component
- If streaming takes too long (>5s), the placeholder should remain visible with its fallback content — don't leave empty holes
- The out-of-order script must be sent before any slot content so the browser knows how to handle arriving chunks
- CSS for streamed-in content must already be loaded (sent in the initial `<head>` or preloaded) to avoid layout shift when content swaps in

**Files likely involved:**
- `src/react/pageHandler.ts` — document and test `<Suspense>` boundary streaming (may already work)
- `src/svelte/renderToReadableStream.ts` — add out-of-order support for `{#await}` blocks
- `src/vue/pageHandler.ts` — add `<Suspense>` boundary support to the streaming pipeline
- `src/angular/pageHandler.ts` — add `@defer` block support to SSR streaming
- New: `src/utils/streamingSlots.ts` — shared utilities for generating placeholder HTML and the `$RC` swap script
- New: `src/client/streamSwap.ts` — the inline client script that handles out-of-order chunk insertion

---

## 6. P1 — Form Actions with Progressive Enhancement

**What SvelteKit and Remix do:**
Forms submit to the server as plain HTML `<form action="/submit" method="POST">` — this works with zero JavaScript. The server processes the form, validates input, and returns a result (redirect, error, or updated page). When JavaScript IS available, the framework intercepts the submission, sends it via `fetch()` instead, and updates the page without a full reload. The developer writes one handler that works both ways.

SvelteKit's form actions return typed data that flows back to the page. Remix's actions return data that's available via `useActionData()`. Both support validation errors that display inline without losing form state.

**What AbsoluteJS has today:**
Elysia POST handlers work for form processing, but there's no convention for progressive enhancement. If JS fails to load, forms don't work unless the developer manually sets up a standard HTML form submission flow. HTMX pages handle this naturally, but React/Svelte/Vue/Angular pages don't.

**Why this matters:**
- Forms are the primary way users mutate data on the web. Every app has them.
- Progressive enhancement means forms work even when JS fails (slow connections, CDN outage, corporate firewalls blocking scripts). This is real resilience, not theoretical.
- The developer writes one handler and gets both behaviors. Less code, more robust.
- Inline validation errors without losing form state is a huge DX win — users hate re-filling forms after a server error.

**What needs to be built:**

*Server side — action handlers:*
- A convention for defining form actions on Elysia routes. This could be as simple as a helper that creates a POST handler with typed input validation:
  ```ts
  import { defineAction } from 'absolutejs'
  import { t } from 'elysia'

  const createUser = defineAction({
    body: t.Object({
      name: t.String(),
      email: t.String({ format: 'email' }),
    }),
    handler: async ({ body }) => {
      const user = await db.insert(users).values(body).returning()
      return { success: true, user }
    },
    error: (errors) => {
      return { success: false, errors }
      // errors is typed: { name?: string, email?: string }
    }
  })

  app.post('/users', createUser)
  ```
- The action handler detects whether the request came from a plain form submission (no JS) or a `fetch()` call (JS available):
  - Plain form: process, then redirect (POST/Redirect/GET pattern) or re-render the page with errors
  - Fetch: return JSON with the result or validation errors
- Detection via `Accept` header — `application/json` means JS fetch, `text/html` means plain form

*Client side — per-framework hooks:*
- **React**: `useFormAction(actionUrl)` hook that returns `{ submit, data, errors, isSubmitting }`. Intercepts `<form onSubmit>`, sends via fetch, returns typed result. Falls back to normal form submission if hook isn't used.
  ```tsx
  const { submit, errors, isSubmitting } = useFormAction('/users')

  <form onSubmit={submit}>
    <input name="name" />
    {errors?.name && <span>{errors.name}</span>}
    <input name="email" />
    {errors?.email && <span>{errors.email}</span>}
    <button disabled={isSubmitting}>Create</button>
  </form>
  ```
- **Svelte**: `useFormAction` that returns a store with the same shape. Bind to `<form use:enhance>` pattern.
- **Vue**: `useFormAction` composable returning reactive refs.
- **Angular**: `FormAction` service that returns an Observable-based interface.
- All hooks preserve form state on validation errors — the form doesn't reset when the server returns errors.

*Progressive enhancement flow:*
1. Server renders the page with a `<form action="/users" method="POST">`
2. If JS loads: the hook intercepts submit, sends fetch, updates UI reactively
3. If JS fails: the form submits normally, server processes it, redirects or re-renders with errors
4. Same server handler handles both cases — the developer doesn't write two code paths

*Type safety:*
- The action's `body` schema (Elysia's `t.Object`) defines both server validation and client-side error types
- `errors` in the hook is typed to match the schema fields — `errors.name` exists only if `name` is in the schema
- The action's return type flows to the hook's `data` — full end-to-end type safety via Elysia's existing type system

**Design considerations:**
- The `<form>` must have a real `action` and `method` attribute for the no-JS path to work. The hook enhances it, doesn't replace it.
- File uploads should work in both paths — `multipart/form-data` for plain forms, `FormData` via fetch for enhanced forms.
- Optimistic UI: the hook could accept an `optimistic` callback that updates the UI immediately before the server responds, then reconciles when the real response arrives.
- CSRF protection should be built in — the action handler validates a token automatically.

**Files likely involved:**
- New: `src/utils/defineAction.ts` — action handler factory with typed validation and dual-mode response
- New: `src/react/hooks/useFormAction.ts` — React hook for form enhancement
- New: `src/svelte/useFormAction.ts` — Svelte store-based form enhancement
- New: `src/vue/useFormAction.ts` — Vue composable for form enhancement
- New: `src/angular/form-action.service.ts` — Angular service for form enhancement
- New: `types/action.ts` — types for action definitions, error shapes, and hook returns

---

## 9. P1 — Security Headers + CSP Nonce Injection

**The problem:**
Most web apps ship with zero security headers. Without a Content-Security-Policy, any XSS vulnerability lets attackers inject arbitrary `<script>` tags that execute freely. AbsoluteJS injects inline scripts on every page (`window.__INITIAL_PROPS__=...`, `$RefreshReg$` buffer, HMR client) — all of these are blocked by a strict CSP unless they have a per-request nonce.

Setting up CSP with nonces manually is painful because every inline script needs the same nonce, the nonce must be cryptographically random per-request, and the CSP header must match. Most developers skip it entirely.

**What AbsoluteJS has today:**
No security headers. No CSP. Inline scripts are injected without nonces.

**What needs to be built:**

*An Elysia plugin — `secureHeaders()`:*
```ts
import { security } from 'absolutejs'

app.use(secureHeaders())
// or with custom config:
app.use(secureHeaders({
  csp: {
    directives: {
      'script-src': ['self'],      // default: 'self' + nonce
      'style-src': ['self', 'unsafe-inline'], // for inline styles
      'img-src': ['self', 'data:'],
      'connect-src': ['self'],     // for fetch/WebSocket
      'font-src': ['self', 'https://fonts.gstatic.com'],
    },
    reportUri: '/api/__csp-report', // optional: log violations
  },
  headers: {
    hsts: true,                     // Strict-Transport-Security
    frameOptions: 'DENY',          // X-Frame-Options
    contentTypeOptions: true,       // X-Content-Type-Options: nosniff
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: {            // Permissions-Policy
      camera: [],
      microphone: [],
      geolocation: [],
    },
  },
}))
```

*How CSP nonces work under the hood:*
1. The `secureHeaders()` plugin runs in `onBeforeHandle` — generates a random nonce per request using `crypto.getRandomValues()` and stores it in the request context via Elysia's `derive`
2. Each framework's page handler reads the nonce from the request context and adds `nonce="..."` to every inline `<script>` tag it generates:
   - `<script nonce="${nonce}">window.__INITIAL_PROPS__=...</script>`
   - `<script nonce="${nonce}">window.$RefreshReg$=...</script>`
   - `<script nonce="${nonce}" type="module" src="..."></script>`
3. The plugin sets the `Content-Security-Policy` header with `'nonce-${nonce}'` in the `script-src` directive
4. The browser allows scripts with the matching nonce and blocks everything else — XSS injections can't guess the nonce

*Subresource Integrity (SRI) in production:*
- During `build()`, compute SHA-384 hashes of all JS and CSS output files
- Store hashes in the manifest alongside file paths
- Page handlers add `integrity="sha384-..."` to `<script>` and `<link>` tags
- If a CDN or proxy tampers with the file, the browser refuses to load it

*Default security headers (all configurable, all on by default):*
- `Content-Security-Policy` — with per-request nonces for inline scripts
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — force HTTPS
- `X-Content-Type-Options: nosniff` — prevent MIME sniffing
- `X-Frame-Options: DENY` — prevent clickjacking via iframes
- `Referrer-Policy: strict-origin-when-cross-origin` — limit referrer leakage
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` — disable unused browser APIs
- `Cross-Origin-Opener-Policy: same-origin` — isolate browsing context
- `Cross-Origin-Resource-Policy: same-origin` — prevent cross-origin resource loading

*CSRF protection (built into the plugin):*
- On every mutating request (POST, PUT, PATCH, DELETE), compare the `Origin` header to the `Host` header. If they don't match, reject with `403 Forbidden`. This prevents a malicious site from making a user's browser submit forms to your server using their cookies.
- This is the OWASP-recommended "Fetch Metadata" approach — no tokens needed, no client-side changes, works automatically.
- Enabled by default. Configurable with `csrf: { allowedOrigins: ['https://trusted.example.com'] }` for cases where cross-origin requests are intentional (e.g., a mobile app hitting your API).
- Safe requests (GET, HEAD, OPTIONS) are not checked — they should never mutate state anyway.
- Requests without an `Origin` header (curl, Postman, server-to-server) can be optionally allowed via `csrf: { allowNoOrigin: true }` for API-only routes.

*Dev mode behavior:*
- CSP is relaxed in dev to allow HMR WebSocket connections (`connect-src: 'self' ws:`) and hot-reloaded scripts
- Other security headers still set in dev so developers see the same behavior as production
- A warning in the dev console if CSP would block something that's only allowed because of dev mode relaxation

**Design considerations:**
- Enabled by default when `app.use(secureHeaders())` is called — secure-by-default, opt-out for specific directives
- The nonce is available in the request context for users who render their own inline scripts: `const nonce = ctx.nonce`
- Google Fonts requires `font-src: 'self' https://fonts.gstatic.com` and `style-src: 'self' https://fonts.googleapis.com` — the default config includes these if `generateHeadElement()` is used with a font
- WebSocket connections for HMR and AI streaming need `connect-src: 'self' ws: wss:` — auto-detected based on which plugins are registered
- CSP violation reporting endpoint (`/api/__csp-report`) is optional — logs violations as structured JSON when enabled

**Files likely involved:**
- New: `src/plugins/secureHeaders.ts` — the Elysia plugin with nonce generation, header setting, and CSP construction
- New: `types/secureHeaders.ts` — configuration types for CSP directives, header options
- `src/react/pageHandler.ts` — read nonce from context, add to all `<script>` tags
- `src/svelte/pageHandler.ts` — same
- `src/vue/pageHandler.ts` — same
- `src/angular/pageHandler.ts` — same
- `src/core/build.ts` — compute SRI hashes for production builds, store in manifest
- `src/build/generateManifest.ts` — include integrity hashes alongside file paths

---

## 10. P2 — Sass/SCSS/Less Preprocessing

**What Next.js does:**
Built-in Sass support. Import `.scss` or `.sass` files directly. Also supports `.module.scss` for scoped Sass modules.

**What AbsoluteJS has today:**
Only `.css` files. Tailwind handles utility classes. No preprocessor support.

**What needs to be built:**
- A Bun build plugin that compiles `.scss`/`.sass`/`.less` files to CSS before bundling
- Bun has a plugin API for custom loaders — register `.scss` extension with a loader that calls the sass compiler
- Support `.module.scss` for scoped Sass modules (Bun's CSS Module handling + Sass compilation)
- Add `sass` as an optional peer dependency

**Files likely involved:**
- New: `src/build/sassPlugin.ts` — Bun plugin that compiles Sass
- `src/core/build.ts` — register the plugin in the Bun.build() calls
- `src/build/scanCssEntryPoints.ts` — extend glob to include `**/*.scss`, `**/*.sass`, `**/*.less`

---

## 11. P2 — Middleware

**What Next.js does:**
A single `middleware.ts` at the project root that runs before every request. Can rewrite URLs, redirect, set headers, check auth, do A/B testing, geolocation-based routing. Runs on the edge (lightweight V8 isolate).

**What AbsoluteJS has today:**
Elysia's full middleware system — `onBeforeHandle`, `onAfterHandle`, `.use()` plugin chain, `derive`, `guard`. This is actually more powerful than Next.js middleware but less conventionalized.

**What needs to be built:**
- Honestly, this might just need documentation. Elysia's `onBeforeHandle` IS middleware. A `guard()` block with auth checks IS the auth middleware pattern.
- Consider a thin `middleware()` helper that wraps the common pattern: check auth, redirect if not authenticated, rewrite URLs, set CORS headers
- Examples showing: auth guard, redirect, URL rewrite, rate limiting, CORS
- The key gap isn't functionality — it's discoverability. New users don't know that Elysia's `onBeforeHandle` is the middleware they're looking for.

**Files likely involved:**
- Mostly documentation/examples
- Optional: `src/utils/middleware.ts` — convenience wrappers for common patterns

---

## 12. P2 — Partial Prerendering (requires SSG)

**What Next.js 16 does:**
A page is split into a static shell (navbar, footer, layout — cached at CDN) and dynamic "holes" that stream in at request time (user-specific content, real-time data). The static parts load instantly from cache while the dynamic parts stream in via SSR. From the user's perspective, the page appears instantly with personalized content filling in smoothly.

Next.js implements this by combining static generation with Suspense boundaries — everything outside a `<Suspense>` boundary is pre-rendered at build time, and the Suspense fallbacks are replaced with streamed server-rendered content at request time.

**What AbsoluteJS has today:**
Every page is fully server-rendered at request time. No static caching of any page content. The entire page waits for all data before any HTML is sent (unless using streaming SSR, which streams in-order but still requires the server to render everything on each request).

**Why this matters:**
Most pages are 80% static content (nav, sidebar, footer, headings, layout) and 20% dynamic (user name, notifications, personalized feed). Rendering that 80% on every request is wasted work. Partial prerendering means:
- The static shell loads from CDN in ~50ms (no server round-trip)
- The dynamic holes stream from the server in ~200-500ms
- Combined: users see a near-instant page with dynamic content appearing smoothly
- Server load drops dramatically — most of the HTML is served from cache

**What needs to be built (depends on SSG being implemented first):**

*Build-time static shell generation:*
- During the build, render each page but stop at dynamic boundaries (Suspense, `{#await}`, `<Suspense>`, `@defer`)
- Write the static HTML (everything outside dynamic boundaries) to disk with placeholder slots for the dynamic parts
- The static shell includes all CSS, the page layout, and fallback content (loading skeletons) for each dynamic slot

*Request-time dynamic streaming:*
- When a request comes in, serve the static shell immediately from disk/cache
- Simultaneously, render the dynamic parts on the server and stream them into the placeholder slots
- Reuse the out-of-order streaming infrastructure — the `$RC` swap script handles inserting dynamic content into the static shell

*Per-framework dynamic boundaries:*
- **React**: `<Suspense>` boundaries — everything inside is dynamic, everything outside is static
- **Svelte**: `{#await}` blocks or a new `<Dynamic>` component
- **Vue**: `<Suspense>` component — same pattern as React
- **Angular**: `@defer` blocks — natural fit, Angular already distinguishes static vs deferred content

*Caching strategy:*
- Static shells cached in memory and/or on disk with content-hash keys
- Cache invalidation: rebuild the shell when the page's static parts change (detected via file watcher or manual invalidation)
- Dynamic parts are never cached (they're user-specific/time-specific)
- CDN integration: set `Cache-Control` headers so the static shell is edge-cached while the dynamic stream bypasses cache

*Configuration:*
- Per-page opt-in via a config option or export:
  ```ts
  // In the route handler
  app.get('/dashboard', () =>
    handleReactPageRequest(Dashboard, manifest['DashboardIndex'], {
      prerender: 'partial',  // static shell + dynamic streaming
      props: { userId: getCurrentUser() }
    })
  )
  ```
- Or via the build config for pages that should always be partially prerendered

**Design considerations:**
- The static shell must be a valid HTML document on its own — if dynamic streaming fails, the user sees the shell with fallback content (loading skeletons), not a broken page.
- Dynamic boundaries should be explicit — the developer marks what's dynamic, everything else is assumed static. No guessing.
- This compounds with islands — an island with `hydrate="visible"` inside a dynamic boundary gets: static shell → streamed SSR HTML → hydrated on scroll. Three layers of progressive loading.
- Hot reloading in dev: skip the static cache and render everything server-side (same as today). Partial prerendering is a production optimization only.

**Files likely involved:**
- Builds on top of SSG implementation and out-of-order streaming
- New: `src/core/partialPrerender.ts` — orchestrates static shell serving + dynamic streaming
- New: `src/build/generateStaticShells.ts` — renders pages at build time, extracts static content, writes shells to disk
- `src/utils/streamingSlots.ts` — reused from out-of-order streaming for dynamic slot insertion
- Each framework's `pageHandler.ts` — add `prerender: 'partial'` mode that serves cached shell + streams dynamic parts
- `src/plugins/hmr.ts` — static shell cache invalidation when source files change

---

## 13. P2 — Web Vitals Reporting

**The problem:**
43% of sites fail the INP (Interaction to Next Paint) threshold. Most developers don't measure real user performance until complaints come in. Adding analytics requires third-party scripts that themselves hurt performance. Vercel has `reportWebVitals()` for Next.js but no other meta-framework has this built in.

**What AbsoluteJS has today:**
HMR timing is reported via WebSocket (`hmr-timing` message type). No production performance measurement.

**What needs to be built:**

*Auto-injected web vitals script:*
- A small inline script (~1KB, not the full `web-vitals` library) that measures Core Web Vitals using the native `PerformanceObserver` API:
  - **LCP** (Largest Contentful Paint) — how fast the main content loads
  - **INP** (Interaction to Next Paint) — how responsive the page is to user input
  - **CLS** (Cumulative Layout Shift) — how much the layout shifts during load
  - **FCP** (First Contentful Paint) — when the first content appears
  - **TTFB** (Time to First Byte) — server response time
- Injected automatically by the page handlers in production (opt-out via config)
- Batches measurements and sends them to a configurable endpoint

*Built-in vitals endpoint:*
```ts
import { vitals } from 'absolutejs'

app.use(vitals())
// or with config:
app.use(vitals({
  endpoint: '/api/__vitals',  // default
  sampleRate: 0.1,            // report 10% of page loads (default: 1.0)
  onReport: (metric) => {
    // Optional: forward to external service (Datadog, Grafana, etc.)
    console.log(metric)
  },
}))
```

- The endpoint receives batched vitals and stores/forwards them
- In-memory aggregation with percentile calculation (P50, P75, P95)
- Exposes `GET /api/__vitals/summary` with aggregated stats (useful for dashboards)

*Dev mode performance overlay:*
- A small floating panel (similar to the error overlay) showing real-time vitals:
  ```
  ┌─────────────────────────┐
  │ LCP  320ms  ✓           │
  │ INP   45ms  ✓           │
  │ CLS  0.02   ✓           │
  │ FCP  180ms  ✓           │
  │ TTFB  12ms  ✓           │
  └─────────────────────────┘
  ```
- Color-coded: green (good), yellow (needs improvement), red (poor) based on Google's thresholds
- Toggle with a keyboard shortcut or `dev: { vitals: true }` in config
- Shows per-navigation metrics when using client-side navigation (`<Link>`)

*Integration with OpenTelemetry:*
- If the OpenTelemetry Elysia plugin is also registered, vitals are exported as OTel metrics
- Trace ID correlation: the vitals report includes the server trace ID from the page request, enabling end-to-end performance analysis (server render time → network → client paint)

**Design considerations:**
- The injected script must not affect the metrics it measures — load it async, measure before injecting any other framework JS
- Sample rate prevents overwhelming the endpoint on high-traffic sites
- Client-side only — vitals are measured in the browser, not during SSR
- The vitals script should work regardless of framework — it's plain JS injected into the HTML, not a React/Svelte/Vue component
- Privacy: no PII collected. Report includes: URL path (not query params), metric name, metric value, user agent, connection type. No cookies, no user IDs.

**Files likely involved:**
- New: `src/plugins/vitals.ts` — Elysia plugin with the reporting endpoint and aggregation
- New: `src/client/vitals.ts` — lightweight client script that measures and reports Core Web Vitals
- New: `src/dev/client/vitalsOverlay.ts` — dev-mode performance overlay
- Each framework's `pageHandler.ts` — inject the vitals script in production builds
- New: `types/vitals.ts` — metric types, config types, report payload types

---

## 14. P2 — Background Jobs + Cron

**The problem:**
Web frameworks only handle request/response. Anything async — email sending, image processing, scheduled cleanups, webhook retries, report generation — requires separate infrastructure (Redis + Bull, separate worker process, cron service). This is the #1 reason apps "outgrow" their framework. Laravel and Rails have built-in queues and schedulers. No JS meta-framework has this.

**What AbsoluteJS has today:**
Nothing. Background work requires external tools.

**Why AbsoluteJS is positioned for this:**
You run a long-lived Bun process. Unlike serverless frameworks (Next.js on Vercel), your server stays alive between requests. A background job runner can live in the same process — no separate worker needed for most use cases. Bun also has native SQLite which can serve as a lightweight job store without Redis.

**What needs to be built:**

*Job definition:*
```ts
import { defineJob, defineCron } from 'absolutejs'

// One-off background job — dispatched from route handlers
export const sendWelcomeEmail = defineJob({
  name: 'send-welcome-email',
  handler: async ({ userId, email }: { userId: string; email: string }) => {
    await emailService.send({
      to: email,
      template: 'welcome',
    })
  },
  retry: {
    maxAttempts: 3,
    backoff: 'exponential', // 1s, 2s, 4s
  },
})

// Scheduled job — runs on a cron schedule
export const dailyCleanup = defineCron({
  name: 'daily-cleanup',
  schedule: '0 3 * * *', // 3 AM daily
  handler: async () => {
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
  },
})
```

*Dispatching jobs from route handlers:*
```ts
app.post('/users', async ({ body }) => {
  const user = await db.insert(users).values(body).returning()

  // Dispatch background job — returns immediately, runs async
  await sendWelcomeEmail.dispatch({
    userId: user.id,
    email: user.email,
  })

  return user
})
```

*Job runner architecture:*
- Jobs stored in Bun's built-in SQLite (`absolutejs_jobs` table) — no Redis required for small-medium apps
- Optional Redis adapter for high-throughput / multi-instance deployments
- Job runner polls the store on a configurable interval (default: 1s)
- Runs in the same Bun process as the server — no separate worker process needed
- Configurable concurrency limit (default: 5 concurrent jobs)
- Dead letter queue — jobs that exhaust retries are moved to a failed table for inspection

*Job lifecycle:*
1. `dispatch()` inserts a row into the job store with status `pending`
2. The runner picks up `pending` jobs, sets status to `running`
3. On success: status → `completed`, row deleted (or archived)
4. On failure: status → `failed`, retry count incremented, next attempt scheduled with backoff
5. On max retries exhausted: status → `dead`, moved to dead letter queue

*Cron scheduler:*
- Parses cron expressions and schedules next execution
- Uses `setTimeout` chains (not `setInterval`) for accuracy
- Prevents overlapping executions — if a cron job is still running when the next tick fires, skip that tick
- Stores last execution time in the job store for crash recovery — if the server restarts, it checks if a scheduled job was missed and runs it

*Elysia plugin:*
```ts
import { jobs } from 'absolutejs'
import { sendWelcomeEmail } from './jobs/sendWelcomeEmail'
import { dailyCleanup } from './jobs/dailyCleanup'

app.use(jobs({
  store: 'sqlite',             // default, or 'redis'
  concurrency: 5,              // max concurrent jobs
  pollInterval: 1000,          // ms between polls
  jobs: [sendWelcomeEmail],    // register one-off jobs
  crons: [dailyCleanup],      // register scheduled jobs
}))
```

*Dev mode:*
- Jobs run immediately in the same process (no polling delay)
- A `/api/__jobs` endpoint that lists pending, running, failed, and dead jobs
- Log output for job start/complete/fail with timing

**Design considerations:**
- Type safety: `dispatch()` is typed to match the job's handler input — `sendWelcomeEmail.dispatch({ userId: 123 })` errors if `email` is missing
- Jobs must be idempotent — the framework can't guarantee exactly-once execution (crashes between "job completed" and "status updated" can cause re-execution)
- SQLite store is single-writer — fine for a single server instance. Multi-instance deployments need Redis.
- Job handlers run in the same process as the server — a CPU-heavy job can block request handling. Consider a warning in docs and an option to spawn jobs in a Bun Worker.
- Graceful shutdown: on `SIGTERM`, stop accepting new jobs, wait for running jobs to complete (with a timeout), then exit.

**Files likely involved:**
- New: `src/jobs/defineJob.ts` — job definition factory with typed handler and retry config
- New: `src/jobs/defineCron.ts` — cron definition factory with schedule parsing
- New: `src/jobs/runner.ts` — job runner that polls the store, executes handlers, manages retries
- New: `src/jobs/store/sqlite.ts` — SQLite-backed job store using Bun's native SQLite
- New: `src/jobs/store/redis.ts` — optional Redis-backed store for multi-instance
- New: `src/plugins/jobs.ts` — Elysia plugin that registers the runner and dev endpoints
- New: `types/jobs.ts` — types for job definitions, store interface, runner config

---

## 15. P2 — Health Check Endpoints

**The problem:**
Every Kubernetes, Docker, ECS, or Fly.io deployment needs health check endpoints. Without them, the orchestrator can't tell if your app is alive, ready to accept traffic, or stuck. Every team implements these ad-hoc with slightly different patterns.

**What AbsoluteJS has today:**
The HMR plugin has a `/hmr-status` endpoint in dev, but nothing for production health checks.

**What needs to be built:**

*An Elysia plugin — `healthChecks()`:*
```ts
import { healthChecks, defineHealthCheck } from 'absolutejs'

// Optional: custom readiness checks
const dbCheck = defineHealthCheck('database', async () => {
  await db.execute(sql`SELECT 1`)
})

const redisCheck = defineHealthCheck('redis', async () => {
  await redis.ping()
})

app.use(healthChecks({
  checks: [dbCheck, redisCheck],
  // Endpoints auto-registered:
  // GET /_health   — liveness (is the process alive?)
  // GET /_ready    — readiness (are dependencies connected?)
  // GET /_startup  — startup (has initialization completed?)
}))
```

*How each endpoint works:*
- **`/_health` (liveness)**: Always returns `200 OK` if the Bun process is running. No external checks. If this fails, the orchestrator restarts the container.
  ```json
  { "status": "ok", "uptime": 84321 }
  ```

- **`/_ready` (readiness)**: Runs all registered health checks in parallel. Returns `200` if all pass, `503` if any fail. If this fails, the orchestrator stops sending traffic until it passes.
  ```json
  {
    "status": "ready",
    "checks": {
      "database": { "status": "ok", "latency": 2 },
      "redis": { "status": "ok", "latency": 1 }
    }
  }
  ```
  Or on failure:
  ```json
  {
    "status": "not_ready",
    "checks": {
      "database": { "status": "ok", "latency": 2 },
      "redis": { "status": "fail", "error": "Connection refused" }
    }
  }
  ```

- **`/_startup` (startup)**: Returns `503` until `prepare()` completes (build done, manifest loaded, compilers warmed). Then returns `200` forever. Prevents the orchestrator from sending traffic before the app is ready.

*Configuration:*
- `timeout: 5000` — max time per health check before it's considered failed
- `cacheDuration: 5000` — cache health check results to avoid hammering dependencies on every probe
- `path: { health: '/_health', ready: '/_ready', startup: '/_startup' }` — customizable paths

**Design considerations:**
- Health check endpoints should NOT be behind auth middleware — the orchestrator needs to reach them unauthenticated
- Error details in `/_ready` should be hidden in production by default (just `"status": "fail"`) to avoid leaking infrastructure info. Configurable with `verbose: true` for internal deployments.
- The startup check should integrate with `prepare()` — set a flag when build + manifest load is complete

**Files likely involved:**
- New: `src/plugins/healthChecks.ts` — Elysia plugin with the three endpoints
- New: `src/utils/defineHealthCheck.ts` — health check factory
- New: `types/health.ts` — types for health check definitions and responses
- `src/core/prepare.ts` — set startup readiness flag when initialization completes

---

## 16. P2 — Structured Logging with Request Context

**The problem:**
`console.log` in production is useless — no request context, no correlation, no structured format. When something breaks, developers grep through unstructured text logs trying to match a request to its errors. Every log line should know which request it belongs to without the developer passing a logger through every function.

**What AbsoluteJS has today:**
`logWarn`, `logError` utilities in `src/utils/logger.ts` for build-time logs. No request-scoped logging. Angular SSR uses `AsyncLocalStorage` for request context but this isn't available to other frameworks.

**What needs to be built:**

*An Elysia plugin — `logging()`:*
```ts
import { logging } from 'absolutejs'

app.use(logging())
// or with config:
app.use(logging({
  level: 'info',              // 'debug' | 'info' | 'warn' | 'error'
  format: 'json',             // 'json' (production) | 'pretty' (dev) | 'auto'
  redact: ['authorization', 'cookie', 'x-api-key'], // headers to redact
}))
```

*How it works:*
- The plugin wraps every request in an `AsyncLocalStorage` context with a unique request ID
- Anywhere in the app, `import { log } from 'absolutejs'` gives a logger that auto-attaches the current request's context:
  ```ts
  import { log } from 'absolutejs'

  // In any function called during request handling — no logger param needed
  log.info('User created', { userId: user.id })
  ```
- Output in production (JSON):
  ```json
  {
    "level": "info",
    "msg": "User created",
    "userId": "abc123",
    "requestId": "req_7f2a3b",
    "method": "POST",
    "path": "/api/users",
    "duration": 45,
    "timestamp": "2026-03-27T22:30:00.000Z"
  }
  ```
- Output in dev (pretty):
  ```
  22:30:00 INFO [POST /api/users] User created userId=abc123 (45ms)
  ```

*Auto-logged events (no user code needed):*
- Request start: method, path, query params, user agent
- Request end: status code, duration, response size
- SSR render: framework, component, render time
- Errors: full stack trace with request context
- Slow requests: warning if request exceeds a configurable threshold (default: 1s)

*Request ID propagation:*
- Generates a unique `requestId` per request (UUID or nanoid)
- Sets `X-Request-Id` response header so clients can reference it in bug reports
- If an incoming request has `X-Request-Id` header (from a load balancer or upstream service), uses that instead — enables distributed tracing

*Integration with existing systems:*
- The logger's JSON output is compatible with any log aggregation tool (Datadog, Loki, CloudWatch, ELK)
- If OpenTelemetry plugin is registered, the request ID correlates with OTel trace/span IDs

**Design considerations:**
- `AsyncLocalStorage` has negligible overhead in Bun — safe to use on every request
- The `log` import is a singleton that reads from `AsyncLocalStorage` — no need to thread a logger through every function call
- Outside of request context (startup, cron jobs, background jobs), `log` still works but without request-specific fields
- Log level is configurable per-environment: `debug` in dev, `info` in production
- Sensitive headers (`authorization`, `cookie`) are redacted by default in log output

**Files likely involved:**
- New: `src/plugins/logging.ts` — Elysia plugin that wraps requests in AsyncLocalStorage with request context
- New: `src/utils/log.ts` — the `log` singleton that reads from AsyncLocalStorage and formats output
- New: `types/logging.ts` — types for log levels, config, and structured log entries
- `src/angular/pageHandler.ts` — can reuse the same AsyncLocalStorage context (currently has its own)

---

## 17. P2 — Parallel Data Loading

**The problem:**
Request waterfalls are the #1 hidden performance killer. A parent component fetches data, renders a child, which fetches its own data, creating sequential roundtrips. On a page with 3 data sources each taking 100ms, a waterfall takes 300ms while parallel loading takes 100ms.

**What AbsoluteJS has today:**
Data is fetched in the route handler and passed as props:
```ts
app.get('/dashboard', async () => {
  const user = await getUser()         // 50ms
  const stats = await getStats()       // 200ms
  const activity = await getActivity() // 100ms
  // Total: 350ms (sequential)

  return handleReactPageRequest(Dashboard, manifest['DashboardIndex'], {
    user, stats, activity
  })
})
```

Developers can manually `Promise.all` these, but it's easy to forget and there's no framework-level pattern for it.

**What needs to be built:**

*A `defineLoader` utility:*
```ts
import { defineLoader } from 'absolutejs'

const userLoader = defineLoader('user', async (ctx) => {
  return await getUser(ctx.headers.authorization)
})

const statsLoader = defineLoader('stats', async () => {
  return await getStats()
})

const activityLoader = defineLoader('activity', async () => {
  return await getActivity()
})
```

*A `loadAll` utility that runs loaders in parallel:*
```ts
import { loadAll } from 'absolutejs'

app.get('/dashboard', async (ctx) => {
  // All three loaders run in parallel — total time = max(50, 200, 100) = 200ms
  const { user, stats, activity } = await loadAll(ctx, [
    userLoader,
    statsLoader,
    activityLoader,
  ])

  return handleReactPageRequest(Dashboard, manifest['DashboardIndex'], {
    user, stats, activity
  })
})
```

*How `loadAll` works:*
- Takes the Elysia request context and an array of loaders
- Runs all loaders with `Promise.all` — true parallel execution
- Returns a typed object where each key matches the loader name and the value matches the loader's return type
- If any loader throws, the error includes which loader failed and the partial results from loaders that succeeded (useful for partial rendering with out-of-order streaming)

*Type safety:*
- `defineLoader` is generic over its return type — `defineLoader('user', async () => getUser())` infers the return as the user type
- `loadAll` returns an object typed as `{ user: User, stats: Stats, activity: Activity[] }` — no manual type annotations needed
- If you pass a loader that doesn't exist, TypeScript errors

*Integration with out-of-order streaming:*
- `loadAll` can return a special object that integrates with streaming — each loader's result streams independently:
  ```ts
  const data = await loadAll(ctx, [userLoader, statsLoader, activityLoader], {
    streaming: true,
  })
  // data.user resolves first (50ms) — streams immediately
  // data.activity resolves next (100ms) — streams into its slot
  // data.stats resolves last (200ms) — streams into its slot
  ```
- This turns sequential data fetching into parallel fetching with progressive rendering — the best of both worlds

*Error handling:*
- Individual loader errors don't crash the whole page — `loadAll` can be configured to return partial results:
  ```ts
  const data = await loadAll(ctx, [userLoader, statsLoader], {
    partial: true, // don't throw if one loader fails
  })
  // data.user — User
  // data.stats — Stats | LoaderError (if it failed)
  ```

**Design considerations:**
- Loaders are just async functions — no magic. `loadAll` is just `Promise.all` with type inference and error handling. The value is the convention, not the implementation.
- Loaders receive the Elysia request context so they can read headers, cookies, query params for auth-gated data
- Loaders can depend on each other — `statsLoader` might need the user ID from `userLoader`. For dependent loaders, use a sequential chain inside the loader itself, or split into two `loadAll` calls.
- Caching: loaders can opt into per-request deduplication — if two components request the same loader, it runs once. Uses a `Map` scoped to the request via `AsyncLocalStorage`.

**Files likely involved:**
- New: `src/utils/defineLoader.ts` — loader factory with typed handler
- New: `src/utils/loadAll.ts` — parallel execution with typed results
- New: `types/loader.ts` — types for loader definitions, results, and error shapes

---

## 18. P2 — CLI Scaffolding / Page Generator

**The problem:**
Adding a new page to an AbsoluteJS app requires: creating the page component file with the right structure, creating a CSS file, adding the route to `server.ts` with the correct page handler import and manifest keys, and updating the build config if needed. This is 3-5 files and getting the imports/manifest keys wrong is a common mistake.

**What AbsoluteJS has today:**
`create-absolutejs` scaffolds entire projects with the correct structure. But there's no command to add a single page to an existing project.

**What needs to be built:**

*A new CLI command — `bun abs generate page`:*
```bash
# Generate a React page
bun abs generate page dashboard --framework react

# Generate a Svelte page
bun abs generate page settings --framework svelte

# Generate a Vue page
bun abs generate page profile --framework vue

# Generate an Angular page
bun abs generate page analytics --framework angular

# Generate an HTML page
bun abs generate page landing --framework html

# Generate an HTMX page
bun abs generate page contact --framework htmx
```

*What it does:*
1. **Reads `absolute.config.ts`** to find the framework directories (`reactDirectory`, `svelteDirectory`, etc.)
2. **Generates the page component** using the same templates and generators from `create-absolutejs`:
   - React: `pages/Dashboard.tsx` with `Head`, `App` wrapper, typed props
   - Svelte: `pages/Dashboard.svelte` with `$props()`, `<svelte:head>`, scoped styles
   - Vue: `pages/Dashboard.vue` with `<script setup>`, `defineProps`, `<style scoped>`
   - Angular: `pages/dashboard.ts` component + template
   - HTML: `pages/Dashboard.html` with boilerplate
   - HTMX: `pages/Dashboard.html` with HTMX attributes
3. **Generates the CSS file** in the styles directory (e.g., `styles/indexes/dashboard.css`)
4. **Updates `server.ts`** — adds the import and route:
   ```ts
   // Added automatically:
   import { Dashboard } from './react/pages/Dashboard'

   // Added to the route chain:
   .get('/dashboard', () =>
     handleReactPageRequest(
       Dashboard,
       asset(manifest, 'DashboardIndex'),
       { cssPath: asset(manifest, 'DashboardCSS') }
     )
   )
   ```
5. **Prints a summary** of what was created and what manifest keys to expect after the next build

*How it modifies `server.ts`:*
- Parses the file using a simple AST or regex to find:
  - The import block — inserts the new import
  - The route chain — inserts the new `.get()` call before `.use(networking)` or `.on('error')`
- Uses the same `generateImportsBlock` and `generateRoutesBlock` patterns from `create-absolutejs`
- If the file structure is too different from the expected pattern (user heavily customized it), falls back to printing the code snippet for manual insertion

*Template source:*
- Reuse the generators from `create-absolutejs` directly — import `generateReactComponents`, `generateSveltePage`, `generateVuePage`, etc.
- The templates produce the same quality output as a freshly scaffolded project
- Respects the project's existing patterns (Tailwind vs plain CSS, auth vs no auth) by reading the config and installed dependencies

*Additional generators:*
```bash
# Generate an API route
bun abs generate api users
# → Creates src/backend/routes/users.ts with GET/POST handlers
# → Adds .use(usersRoutes) to server.ts

# Generate a component (not a page — no route)
bun abs generate component Button --framework react
# → Creates src/frontend/react/components/Button.tsx
```

**Design considerations:**
- The generator must be idempotent-safe — running it twice for the same page should warn "Dashboard page already exists" instead of overwriting
- Page names are PascalCased automatically — `bun abs generate page user-settings` creates `UserSettings.tsx`
- The route path is kebab-cased from the page name — `UserSettings` → `/user-settings`
- If multiple frameworks are configured, `--framework` is required. If only one framework is configured, it's the default.
- The generator should work even if `create-absolutejs` isn't installed — the templates should be bundled with the `absolutejs` CLI

**Files likely involved:**
- `src/cli/index.ts` — add `generate` command with `page`, `api`, `component` subcommands
- New: `src/cli/scripts/generate.ts` — orchestrates the generation
- New: `src/cli/generators/generatePage.ts` — page generation logic (reuses create-absolutejs templates)
- New: `src/cli/generators/generateRoute.ts` — parses server.ts and inserts import + route
- New: `src/cli/generators/generateComponent.ts` — component-only generation (no route)
- New: `src/cli/generators/generateApi.ts` — API route generation
- Import/adapt generators from `create-absolutejs/src/generators/` — the page and component templates

---

## 19. P2 — CLI Framework Adder

**The problem:**
A project starts with React only. Six months later the team wants to add a Svelte page for a performance-critical widget, or a Vue page because a new hire knows Vue. Today this requires manually creating the framework directory, installing dependencies, updating `absolute.config.ts`, adding the page handler import to `server.ts`, and knowing the correct handler API for that framework. It's error-prone and undocumented.

**What AbsoluteJS has today:**
`create-absolutejs` scaffolds projects with multiple frameworks from the start, but there's no way to add a framework to an existing project.

**What needs to be built:**

*A new CLI command — `bun abs add`:*
```bash
bun abs add react
bun abs add svelte
bun abs add vue
bun abs add angular
bun abs add html
bun abs add htmx
```

*What it does — step by step:*

1. **Checks if the framework is already configured** — reads `absolute.config.ts`, warns and exits if the framework directory is already set.

2. **Installs framework dependencies** — runs `bun add` with the correct packages:
   - React: `react`, `react-dom`, `@types/react`, `@types/react-dom`
   - Svelte: `svelte`
   - Vue: `vue`, `@vue/compiler-sfc`, `vue-tsc`
   - Angular: `@angular/core`, `@angular/common`, `@angular/platform-browser`, `@angular/platform-server`, `@angular/compiler-cli`, `@angular/ssr`, `zone.js`
   - HTML: no deps
   - HTMX: no deps (copies `htmx.min.js` to the directory)

3. **Creates the framework directory** with the correct structure using the same layout as `create-absolutejs`:
   - `src/frontend/{framework}/pages/`
   - `src/frontend/{framework}/components/`
   - `src/frontend/{framework}/composables/` (Svelte, Vue)
   - `src/frontend/{framework}/templates/` (Angular)

4. **Generates a starter page** using the same templates from `create-absolutejs`:
   - React: `ReactExample.tsx` with `Head`, `App`, `Dropdown` components
   - Svelte: `SvelteExample.svelte` with counter using `$props()` and `$state()`
   - Vue: `VueExample.vue` with `<script setup>`, `defineProps`, composition API counter
   - Angular: `angular-example.ts` with counter component + template
   - HTML: `HTMLExample.html` with boilerplate
   - HTMX: `HTMXExample.html` with counter endpoints and `hx-` attributes

5. **Generates a CSS file** in the styles directory (`styles/indexes/{framework}-example.css`)

6. **Updates `absolute.config.ts`** — inserts the framework directory config:
   ```ts
   // Added:
   svelteDirectory: 'src/frontend/svelte',
   ```

7. **Updates `server.ts`** — adds the import and a route for the starter page:
   ```ts
   // Added import:
   import { handleSveltePageRequest } from 'absolutejs/svelte'

   // Added route:
   .get('/svelte', async () => {
     const SvelteExample = (await import('./svelte/pages/SvelteExample.svelte')).default
     return handleSveltePageRequest(
       SvelteExample,
       asset(manifest, 'SvelteExample'),
       asset(manifest, 'SvelteExampleIndex'),
       { cssPath: asset(manifest, 'SvelteExampleCSS'), initialCount: 0 }
     )
   })
   ```

8. **Updates navigation** — if a `Dropdown` component exists (the framework switcher), adds the new framework link

9. **Prints a summary:**
   ```
   ✓ Added Svelte to your project

   Created:
     src/frontend/svelte/pages/SvelteExample.svelte
     src/frontend/svelte/components/Counter.svelte
     src/frontend/svelte/composables/counter.svelte.ts
     src/frontend/styles/indexes/svelte-example.css

   Updated:
     absolute.config.ts — added svelteDirectory
     src/backend/server.ts — added /svelte route

   Run `bun run dev` to see your new Svelte page at /svelte
   ```

*How it modifies files:*
- `absolute.config.ts`: parses the `defineConfig({...})` object and inserts the new property. Regex/AST to find the config object, insert the key before the closing brace.
- `server.ts`: same approach as the page generator — find the import block, find the route chain (before `.use(networking)` or `.on('error')`), insert in the right spots.
- If files are too heavily customized to safely modify, falls back to printing the code snippets for manual insertion.

*Removing a framework:*
```bash
bun abs remove svelte
```
- Removes the directory config from `absolute.config.ts`
- Does NOT delete the framework directory or source files — too destructive, user does this manually
- Warns which routes in `server.ts` reference the removed framework so the user can clean up
- Removes framework dependencies via `bun remove` (only if no other framework needs them)

**Design considerations:**
- Detect the project structure automatically — if the project uses `src/frontend/` (create-absolutejs default) vs `example/` (the absolutejs repo), adapt paths by reading existing `absolute.config.ts` directory patterns and following the same convention.
- Version alignment: install the same dependency versions that the current AbsoluteJS version is tested with. Bundle a version manifest with the CLI.
- If HTMX is added, also install `elysia-scoped-state` and add the HTMX counter endpoints as a starter.
- If Angular is added, handle the extra complexity — it has the most dependencies and setup of any framework.
- The scaffolding should work offline (templates are bundled with the CLI) — only `bun add` needs network.
- Idempotent — running `bun abs add react` when React is already configured prints a message and exits, doesn't break anything.

**Files likely involved:**
- `src/cli/index.ts` — add `add` and `remove` commands
- New: `src/cli/scripts/add.ts` — orchestrates the framework addition
- New: `src/cli/scripts/remove.ts` — orchestrates framework removal (config + deps only, not file deletion)
- New: `src/cli/generators/addFramework.ts` — shared logic for directory creation, config updates, server.ts modification
- Reuse generators from `create-absolutejs/src/generators/` — `scaffoldReact`, `scaffoldSvelte`, `scaffoldVue`, `scaffoldAngular`, `scaffoldHTML`, `scaffoldHTMX`
- Reuse `generateImportsBlock` and `generateRoutesBlock` from `create-absolutejs/src/generators/project/`

---

## 20. P3 — Internationalization (i18n)

**What Next.js does:**
Built-in locale routing (`/en/about`, `/fr/about`), locale detection from Accept-Language header, and domain-based routing. Integrates with i18n libraries like next-intl.

**What AbsoluteJS has today:**
Nothing.

**What needs to be built:**
- Locale detection middleware (Accept-Language header parsing, cookie-based locale persistence)
- URL prefix routing pattern (`/:locale/page`)
- A helper to load translation files and inject them as props
- Per-framework translation access patterns (React context, Vue provide/inject, Svelte stores)
- This is mostly a pattern/plugin, not core framework work

**Files likely involved:**
- New: `src/plugins/i18n.ts` — Elysia plugin for locale detection and routing
- Documentation showing integration with popular i18n libraries

---

## 21. P3 — Font Optimization

**What Next.js does:**
`next/font` automatically downloads Google Fonts at build time (no external requests), subsets them, adds `font-display: swap`, and inlines the CSS. Self-hosted fonts get the same optimizations. Zero layout shift from font loading.

**What AbsoluteJS has today:**
`generateHeadElement()` adds a Google Fonts `<link>` with `display=swap`. Fonts are loaded at runtime from Google's CDN.

**What needs to be built:**
- A build-time step that downloads declared Google Fonts, subsets them (woff2), and writes them to the assets directory
- Inline the `@font-face` CSS directly in the `<head>` instead of linking to Google
- This eliminates the external request to Google, improves privacy, and prevents FOUT
- Consider a `defineFont()` helper that takes a font config and returns the CSS + paths

**Files likely involved:**
- New: `src/build/downloadFonts.ts` — fetches and subsets Google Fonts at build time
- `src/utils/generateHeadElement.ts` — inline font CSS instead of external link
- `src/core/build.ts` — add font download step to build pipeline

---

## 22. P3 — Edge Runtime / Serverless Deployment

**What Next.js does:**
Routes can opt into the Edge Runtime (lightweight V8) for lower latency at the edge. Serverless function deployment on Vercel, AWS Lambda, Cloudflare Workers. Middleware always runs on edge.

**What AbsoluteJS has today:**
Bun-only. Requires a long-running Bun server process. No serverless or edge adapter.

**What needs to be built:**
- Deployment adapters for common platforms (Fly.io, Railway, Render are easy since they support Bun directly)
- Docker template with a minimal Bun image
- For serverless: an adapter that wraps the Elysia server as a Lambda/Cloud Function handler
- Edge runtime is unlikely to be worth pursuing — Bun doesn't run on Cloudflare Workers, and the Bun server is already fast enough that edge latency gains are marginal
- Focus on making traditional deployment dead simple rather than chasing edge

**Files likely involved:**
- New: `src/adapters/docker/Dockerfile`
- New: `src/adapters/lambda.ts` — AWS Lambda adapter
- Documentation for common deployment targets

# AbsoluteJS Roadmap — Next.js Feature Parity

Features missing from AbsoluteJS that Next.js provides, ordered by priority. Each entry includes what Next.js does, what AbsoluteJS currently has, and what needs to be built.

---

## P0 — Static Site Generation (SSG)

**What Next.js does:**
Pages can be pre-rendered at build time into static HTML. `generateStaticParams()` tells the framework which dynamic routes to pre-render. The output is plain HTML + JS that can be served from a CDN with zero server runtime. Next.js also supports a full `output: 'export'` mode that produces a completely static site.

**What AbsoluteJS has today:**
Nothing. Every page is rendered at request time via streaming SSR. The `handleHTMLPageRequest` serves pre-written HTML files, but there's no mechanism to run a React/Svelte/Vue component through SSR at build time and save the output.

**What needs to be built:**
- A `static` option per-route or per-page that tells the build to render the component and write the HTML to disk
- For dynamic routes, a way to declare the set of params to pre-render (equivalent to `generateStaticParams`)
- A static export mode that produces a directory of HTML/CSS/JS with no server dependency
- The build pipeline already has streaming SSR for all frameworks — the core work is calling those renderers during `build()` instead of at request time, and writing the output to files
- Static pages should still hydrate on the client (same as today, just the initial HTML comes from disk instead of runtime SSR)

**Files likely involved:**
- `src/core/build.ts` — add a static rendering pass after bundling
- Each framework's `pageHandler.ts` — extract the rendering logic so it can be called at build time without an HTTP request
- `src/build/generateManifest.ts` — static pages need manifest entries pointing to `.html` files
- New: a config option or per-page export to opt into static rendering

---

## P0 — Metadata API / SEO

**What Next.js does:**
Pages export a `metadata` object or `generateMetadata()` async function that defines title, description, Open Graph tags, Twitter cards, canonical URLs, etc. Next.js also supports file-based conventions: `sitemap.ts`, `robots.ts`, `opengraph-image.tsx` that auto-generate SEO assets. The metadata merges and deduplicates across layouts.

**What AbsoluteJS has today:**
`generateHeadElement()` utility that produces a `<head>` string with title, description, favicon, Google Fonts, and CSS paths. Vue and Angular page handlers accept a `headTag` parameter. React pages build their own `<Head>` component manually.

**What needs to be built:**
- A richer metadata type that covers Open Graph (`og:title`, `og:image`, `og:description`, `og:url`), Twitter cards (`twitter:card`, `twitter:title`, `twitter:image`), canonical URL, robots directives, and arbitrary meta tags
- Update `generateHeadElement()` to accept and render all of these
- A `sitemap.ts` convention or helper that generates `/sitemap.xml` from the route list
- A `robots.ts` convention or helper that generates `/robots.txt`
- JSON-LD / structured data helper for rich search results

**Files likely involved:**
- `src/utils/generateHeadElement.ts` — expand the metadata type and rendering
- `types/build.ts` or new `types/metadata.ts` — define the metadata type
- New: `src/utils/generateSitemap.ts`, `src/utils/generateRobots.ts`

---

## P1 — Image Optimization

**What Next.js does:**
`<Image>` component that automatically converts images to WebP/AVIF, generates responsive `srcset` attributes, lazy loads with blur placeholders, and serves optimized images through an on-demand image optimization API route. Prevents layout shift with required width/height.

**What AbsoluteJS has today:**
Nothing. Images are served as-is from the public/assets directory.

**What needs to be built:**
- An `<Image>` component (React version at minimum, ideally per-framework) that renders responsive `<img>` tags with `srcset`, `sizes`, `loading="lazy"`, and `width`/`height` for CLS prevention
- An image optimization endpoint or build-time processor that converts to WebP/AVIF and generates multiple sizes
- Sharp or libvips integration for the actual image processing (Sharp works with Bun)
- Caching layer for optimized images so they're only processed once
- Optional blur placeholder generation (tiny base64 inline preview)

**Files likely involved:**
- New: `src/react/components/Image.tsx`, and equivalents for other frameworks
- New: `src/plugins/imageOptimizer.ts` — Elysia plugin that handles `/image?url=...&w=...&q=...` requests
- New: `src/build/optimizeImages.ts` — optional build-time optimization pass

---

## P1 — Loading / Error / Not-Found States

**What Next.js does:**
Per-route-segment `loading.tsx` (shows during async data fetch), `error.tsx` (catches runtime errors with React error boundary), and `not-found.tsx` (404 page). These are automatic — drop the file in and it works.

**What AbsoluteJS has today:**
- Dev error overlay (`src/dev/client/errorOverlay.ts`) for compilation/runtime errors in development
- SSR error page (`src/utils/ssrErrorPage.ts`) that returns a styled error page when server rendering fails
- No production error boundaries, no loading states, no 404 handling

**What needs to be built:**
- A documented pattern for error boundaries per framework (React has `ErrorBoundary`, Vue has `onErrorCaptured`, Svelte has `<svelte:boundary>`, Angular has `ErrorHandler`)
- A helper or wrapper that each page handler can use to catch SSR errors and render a user-defined error page instead of the generic one
- A loading state pattern — for React this means Suspense boundaries with fallback UI; for streaming SSR, sending the shell immediately and streaming content as it resolves
- A 404 handler — an Elysia catch-all route that renders a user-defined not-found page
- Framework-specific examples showing how to wire each of these up

**Files likely involved:**
- `src/utils/ssrErrorPage.ts` — make it accept a user-defined error component
- Each framework's `pageHandler.ts` — add error/loading handling to the streaming pipeline
- New: `src/utils/notFoundPage.ts` or a convention for 404 pages
- Example directory — add error/loading/not-found examples

---

## P1 — Layout Pattern

**What Next.js does:**
`layout.tsx` files that wrap child pages and persist across navigations. Nested layouts compose — a root layout wraps a dashboard layout wraps a settings page. Layout state (like sidebar scroll position) is preserved when navigating between child pages.

**What AbsoluteJS has today:**
Nothing built-in. Users manually wrap each page component with shared UI.

**What needs to be built:**
- This does NOT need to be file-based. A documented, ergonomic pattern for layouts per framework is enough.
- A `withLayout(LayoutComponent, PageComponent)` wrapper or similar helper that composes layout + page for each route
- For React: a layout component that receives `children` and wraps the page content
- For Svelte/Vue: slot-based layout components
- The key challenge is state preservation across navigations — without client-side routing, every navigation is a full page load and layout state resets. This is where client-side navigation (see below) becomes relevant.
- Consider a `<Shell>` or `<Layout>` component per framework that handles the common outer HTML (head, nav, footer)

**Files likely involved:**
- New: `src/react/components/Layout.tsx` or a helper function
- New: `src/svelte/Layout.svelte`, `src/vue/Layout.vue` patterns
- Documentation / examples showing the pattern

---

## P2 — Incremental Static Regeneration (ISR)

**What Next.js does:**
Static pages can declare a `revalidate` interval (e.g., 60 seconds). After the interval, the next request triggers a background re-render. The stale page is served immediately while the new one generates. `revalidatePath()` and `revalidateTag()` allow on-demand revalidation from API routes or server actions.

**What AbsoluteJS has today:**
Nothing. No static generation means no revalidation.

**What needs to be built (requires SSG first):**
- A `revalidate` option per static page that sets a TTL
- Background re-rendering: when a request comes in for a stale page, serve the cached version and trigger a rebuild in the background
- On-demand revalidation: an API to invalidate specific pages programmatically
- A cache store for rendered pages (filesystem or in-memory)

**Files likely involved:**
- Builds on top of SSG implementation
- New: `src/core/staticCache.ts` — manages cached HTML with TTLs
- New: `src/plugins/revalidation.ts` — Elysia plugin for on-demand revalidation endpoints

---

## P2 — Client-Side Navigation / SPA Transitions

**What Next.js does:**
`<Link>` component that intercepts clicks and does client-side navigation — fetches only the new page's data/RSC payload, swaps the content, preserves layout state. Prefetches linked pages on hover/viewport. This is what makes layouts actually persistent.

**What AbsoluteJS has today:**
Plain `<a>` tags. Every navigation is a full page load.

**What needs to be built:**
- A `<Link>` component per framework that intercepts clicks and fetches the new page via fetch
- A server endpoint that returns just the page content (not the full HTML shell) for client-side nav
- Prefetching on hover or viewport intersection
- History API integration (pushState/popState)
- This is a large feature that fundamentally changes the app architecture. Consider using the View Transitions API as a lighter alternative for smooth navigations without full SPA routing.

**Files likely involved:**
- New: per-framework Link components
- New: `src/plugins/pageNavigation.ts` — server endpoint for partial page responses
- Integration with the View Transitions API (already used in Angular HMR)

---

## P2 — Sass/SCSS/Less Preprocessing

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

## P2 — Middleware

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

## P3 — Internationalization (i18n)

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

## P3 — Font Optimization

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

## P3 — Edge Runtime / Serverless Deployment

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

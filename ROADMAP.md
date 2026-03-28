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

## P1 — Client-Side Navigation / SPA Mode with `<Link>`

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

## P1 — Islands Architecture (Multi-Framework Pages)

**What Astro does:**
Pages are rendered as static HTML with interactive "islands" — individual components that hydrate independently. Each island can be a different framework (React, Svelte, Vue, etc.) on the same page. Hydration is controlled with directives: `client:load` (immediate), `client:idle` (requestIdleCallback), `client:visible` (IntersectionObserver). Non-interactive content ships zero JS.

**What AbsoluteJS has today:**
Each page is owned by one framework. A React page is fully React, a Svelte page is fully Svelte. All the framework SSR renderers, vendor bundles, and hydration entry points already exist — but they can't be mixed on a single page.

**Why AbsoluteJS is uniquely positioned:**
No other meta-framework has SSR renderers, build pipelines, and vendor bundles for React, Svelte, Vue, and Angular already running in the same process. Astro supports islands but the host page uses Astro's own template language — you can't use a React component as the page shell with Svelte islands inside it. AbsoluteJS can because the framework renderers are already first-class.

**What needs to be built:**

*Island rendering (SSR side):*
- An `island()` function that takes a component, its framework type, and props, and returns the server-rendered HTML wrapped in a marker element:
  ```html
  <div data-island="react" data-component="Chart" data-props="..." data-hydrate="load">
    <!-- SSR'd React HTML -->
  </div>
  ```
- The page handler renders the host page first, then renders each island with its framework's SSR renderer and injects the HTML into the marker elements
- For streaming: the page shell streams immediately, islands can resolve asynchronously and stream in as they complete (similar to React Suspense boundaries)

*Island hydration (client side):*
- A small island runtime (~2-3KB) that runs on page load and finds all `data-island` elements
- For each island, loads the framework vendor bundle and component module, then hydrates that specific DOM subtree
- Hydration directives control timing:
  - `client:load` — hydrate immediately on page load
  - `client:idle` — hydrate during `requestIdleCallback` (after main thread is free)
  - `client:visible` — hydrate when the island scrolls into the viewport (`IntersectionObserver`)
  - `client:none` — never hydrate (static HTML only, zero JS for that island)
- Each island hydrates independently — React hydrates its div, Svelte mounts into its div, Vue creates its app on its div. They don't interfere with each other.

*Shared state between islands (zustand/vanilla):*
- Use `zustand/vanilla` as an internal dependency (~1KB, no framework coupling) for cross-island state
- AbsoluteJS exposes a simple API per framework — users never see zustand:
  - React: `useIslandState(key)` hook — wraps zustand subscribe with `useSyncExternalStore`
  - Svelte: `getIslandState(key)` — returns a Svelte-compatible readable store backed by zustand subscribe
  - Vue: `useIslandState(key)` composable — returns a `ref` that syncs via zustand subscribe
  - Angular: `IslandState` injectable service — wraps zustand subscribe in an Observable
- State is initialized on the server and serialized to `window.__ISLAND_STATE__` alongside `window.__INITIAL_PROPS__`
- Islands that share state subscribe to the same zustand store keys and stay in sync automatically

*Build pipeline changes:*
- Island components need to be compiled and bundled individually (not as part of a full-page bundle)
- Each island becomes its own entry point so the browser only loads the framework code for islands actually on the page
- The manifest needs to track island components: `{ "ReactChart": "/islands/react-chart.hash.js", ... }`
- Framework vendor bundles are loaded on-demand — if a page has only React and Svelte islands, Vue and Angular vendors are never loaded

*Type-safe island registry — instant IDE autocomplete, no codegen:*

Type safety comes from a user-maintained registry file. The user defines which island components exist per framework and what their props are. AbsoluteJS provides `defineIslandRegistry()` for validation and an `IslandRegistry` type that the `<Island>` components read from. This gives full IDE autocomplete immediately — no build step needed.

**The registry file (user creates once, updates as islands are added):**
```ts
// islands/registry.ts
import { defineIslandRegistry } from 'absolutejs'
import SvelteForm from './SvelteForm.svelte'
import ContactForm from './ContactForm.svelte'
import Notifications from './Notifications.vue'
import { Chart } from './Chart'

export const islandRegistry = defineIslandRegistry({
  svelte: {
    SvelteForm,
    ContactForm,
  },
  vue: {
    Notifications,
  },
  react: {
    Chart,
  },
})
```

No type casts. You pass the actual components and `defineIslandRegistry()` infers the props types from them — the same way `handleReactPageRequest` infers `Props` from `ReactComponent<Props>` and `handleSveltePageRequest` infers `P` from `SvelteComponent<P>`. The generic signature extracts props from each framework's component type (`ComponentType<P>` for React, `Component<P>` for Svelte, etc.) so the registry knows exactly what props each island accepts.

`defineIslandRegistry()` also serves as the runtime registry — the island renderer uses it to look up the actual component at SSR time. One object, two purposes: type inference for the IDE and component resolution for the server.

**How the types flow through `<Island>`:**

Same pattern as Eden Treaty — you pass the registry to a factory function that returns a typed `<Island>` component. No module augmentation, no global declarations. The type safety lives at the call site.

Each framework exports a `createIsland` function that takes the registry and returns a typed `<Island>` component:

```tsx
// islands/index.ts — one line per framework you use as a host
import { createIsland } from 'absolutejs/react'
import { islandRegistry } from './registry'

export const Island = createIsland(islandRegistry)
```

Now `Island` knows the full registry type. `framework` narrows `component`, `component` narrows `props` — all inferred from what you passed in.

**React host page:**
```tsx
import { Island } from '../islands'

export const Dashboard = ({ data }: DashboardProps) => (
  <div>
    <ReactChart data={data} />
    <Island
      framework="svelte"           // autocomplete: "svelte" | "vue" | "react"
      component="SvelteForm"       // autocomplete: "SvelteForm" | "ContactForm"
      props={{ fields: data.form }} // typed as SvelteFormProps — error if wrong
      hydrate="load"
    />
    <Island
      framework="vue"
      component="Notifications"     // autocomplete: "Notifications"
      props={{ count: 3 }}          // typed as NotificationsProps
      hydrate="visible"
    />
  </div>
)
```

**Svelte host page:**
```svelte
<script lang="ts">
  // Svelte equivalent: createIsland from 'absolutejs/svelte'
  import { Island } from '../islands/svelte'
</script>

<h1>Analytics</h1>
<Island
  framework="react"
  component="Chart"
  props={{ data: [1, 2, 3] }}
  hydrate="load"
/>
<Island
  framework="vue"
  component="Notifications"
  props={{ count: 5 }}
  hydrate="idle"
/>
```

**Vue host page:**
```vue
<script setup lang="ts">
// Vue equivalent: createIsland from 'absolutejs/vue'
import { Island } from '../islands/vue'
const chartData = [1, 2, 3]
</script>

<template>
  <h1>Dashboard</h1>
  <Island
    framework="react"
    component="Chart"
    :props="{ data: chartData }"
    hydrate="visible"
  />
  <Island
    framework="svelte"
    component="SvelteForm"
    :props="{ fields: ['name', 'email'] }"
    hydrate="load"
  />
</template>
```

**Angular host page:**
```typescript
import { Component } from '@angular/core'
// Angular: createIslandDirective from 'absolutejs/angular'
import { IslandComponent } from '../islands/angular'

@Component({
  selector: 'app-dashboard',
  imports: [IslandComponent],
  template: `
    <h1>Dashboard</h1>
    <abs-island
      framework="react"
      component="Chart"
      [props]="{ data: chartData }"
      hydrate="load"
    />
    <abs-island
      framework="svelte"
      component="ContactForm"
      [props]="{ fields: formFields }"
      hydrate="idle"
    />
  `
})
export class DashboardComponent {
  chartData = [1, 2, 3]
  formFields = ['name', 'email']
}
```

**HTML/HTMX host page (attribute-based, no type safety):**
```html
<h1>Landing Page</h1>
<div data-island="react" data-component="Chart" data-hydrate="visible"
     data-props='{"data":[1,2,3]}'>
  <!-- SSR'd at request time -->
</div>
<div data-island="svelte" data-component="ContactForm" data-hydrate="load">
  <!-- SSR'd at request time -->
</div>
```

*What AbsoluteJS provides (in `types/island.ts`):*
```ts
import type { ComponentType as ReactComponent } from 'react'
import type { Component as SvelteComponent } from 'svelte'

// Extract props from any framework's component type
type ExtractReactProps<C> = C extends ReactComponent<infer P> ? P : never
type ExtractSvelteProps<C> = C extends SvelteComponent<infer P> ? P : never
// Vue and Angular equivalents follow the same pattern

// Maps a record of components to a record of their extracted props
type ExtractFrameworkProps<F extends string, Components extends Record<string, unknown>> = {
  [K in keyof Components]: F extends 'react' ? ExtractReactProps<Components[K]>
    : F extends 'svelte' ? ExtractSvelteProps<Components[K]>
    : F extends 'vue' ? ExtractVueProps<Components[K]>
    : F extends 'angular' ? ExtractAngularProps<Components[K]>
    : never
}

// Inferred registry type — maps framework -> component name -> props
type InferredRegistry<T> = {
  [F in keyof T]: ExtractFrameworkProps<F & string, T[F] & Record<string, unknown>>
}

// Defaults to 'load' — most islands are interactive, so the common case needs no prop
type IslandHydrate = 'load' | 'idle' | 'visible' | 'none'

// defineIslandRegistry — accepts actual components, infers all props types
// Returns the registry for both runtime SSR lookup and type-level inference
const defineIslandRegistry = <
  T extends Partial<Record<'react' | 'svelte' | 'vue' | 'angular', Record<string, unknown>>>
>(registry: T) => registry as unknown as InferredRegistry<T>

// createIsland — factory that takes a registry and returns a typed component
// Same pattern as Eden's treaty() — pass the type source, get type safety out
// Each framework exports its own version:
//   absolutejs/react  → createIsland(registry) returns a React <Island> component
//   absolutejs/svelte → createIsland(registry) returns a Svelte <Island> component
//   absolutejs/vue    → createIsland(registry) returns a Vue <Island> component
//   absolutejs/angular → createIslandDirective(registry) returns an Angular directive
//
// The returned component's props are constrained by the registry:
//   <Island framework={F} component={C} props={InferredRegistry[F][C]} hydrate={...} />
```

The key insight: `defineIslandRegistry` accepts actual imported components at runtime (for SSR lookup) and infers their props types through generics (for IDE autocomplete). `createIsland` takes that registry and returns a framework-specific `<Island>` component whose `framework` → `component` → `props` chain is fully typed. Same pattern as Eden Treaty — pass the type source in, get type safety out. No module augmentation, no codegen, no type casts.

*How `<Island>` works under the hood:*
- **On the server:** The `<Island>` component calls the target framework's SSR renderer with the given props, gets back HTML, and renders it inside a `<div>` marker with `data-island`, `data-component`, `data-hydrate`, and serialized `data-props` attributes. In React this uses `dangerouslySetInnerHTML`, in Svelte it uses `{@html}`, in Vue it uses `v-html`, in Angular it uses `[innerHTML]`.
- **On the client:** The island runtime script finds all `data-island` elements, loads the right framework vendor + component module from the manifest, and hydrates each one independently based on its `hydrate` directive.
- **The `<Island>` component itself ships zero JS to the client** — it's SSR-only. The client-side hydration is handled entirely by the island runtime.

**Design considerations:**
- Islands must be self-contained — they hydrate independently with their own props. Cross-island communication goes through the shared zustand store, not prop drilling.
- The island runtime should detect which frameworks are used on the page and only load those vendor bundles. If a page has 5 React islands and 1 Svelte island, React vendor loads once (shared), Svelte vendor loads once.
- CSS for each island should be scoped or co-located. CSS Modules work naturally here — each island's styles are hashed and don't collide.
- Islands inside islands (nested cross-framework) should be explicitly unsupported in v1 to keep complexity down.
- HMR needs to work per-island — editing a Svelte island component should hot-reload just that island, not the entire page.

**Files likely involved:**
- New: `src/react/components/Island.tsx` — React `<Island>` component (SSR-only, renders other frameworks inline)
- New: `src/svelte/Island.svelte` — Svelte `<Island>` component
- New: `src/vue/Island.vue` — Vue `<Island>` component
- New: `src/angular/island.component.ts` — Angular `<abs-island>` component
- New: `src/core/islandRenderer.ts` — shared server-side logic that calls the right framework's SSR renderer for an island
- New: `types/island.ts` — `IslandRegistryMap`, `IslandFramework`, `IslandComponent`, `IslandProps`, `IslandHydrate` types + `defineIslandRegistry()`
- New: `src/build/scanIslands.ts` — scans the registry at build time to discover island entry points for bundling
- New: `src/client/islandRuntime.ts` — client-side island discovery, framework loading, and hydration orchestration
- New: `src/client/islandState.ts` — zustand/vanilla-backed shared state with per-framework wrappers
- New: `src/react/hooks/useIslandState.ts` — React hook for shared island state
- New: `src/svelte/islandState.ts` — Svelte store wrapper for shared island state
- New: `src/vue/useIslandState.ts` — Vue composable for shared island state
- New: `src/angular/island-state.service.ts` — Angular service for shared island state
- `src/core/build.ts` — add island entry point discovery and per-island bundling
- `src/build/generateManifest.ts` — track island components in the manifest
- Each framework's `pageHandler.ts` — support rendering island components inline during page SSR
- `src/plugins/hmr.ts` — per-island HMR updates

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

---

## P1 — Out-of-Order Streaming

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

## P1 — Form Actions with Progressive Enhancement

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

## P2 — Partial Prerendering (requires SSG)

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

## P1 — AI/LLM Streaming Helpers

**What exists today in the ecosystem:**
Vercel's `ai` SDK (`npm install ai`) provides React hooks and server utilities for streaming LLM responses. It works with Next.js, SvelteKit, and Nuxt. But it uses Server-Sent Events (SSE) because Next.js has no native WebSocket support. SSE is one-directional (server → client only) — the client can't send messages mid-stream (cancel, follow-up, branch conversation) without opening a new HTTP request.

**What AbsoluteJS has today:**
Native bidirectional WebSocket via Elysia. The HMR system already proves the WebSocket infrastructure works at scale with reconnection, message typing, and broadcast. But there are no helpers for connecting an LLM API to a WebSocket channel.

**Why this is a killer feature:**
AI-powered apps are the dominant use case for new web projects in 2025-2026. Every chat interface, AI assistant, code editor, and content generator needs LLM streaming. The current state of the art (Vercel AI SDK over SSE) has real limitations:
- SSE is one-directional — canceling a generation requires a separate abort request
- SSE connections can't be reused — each message opens a new HTTP connection
- No native support for branching conversations, tool use feedback, or multi-turn streaming
- WebSocket solves all of these: bidirectional, persistent, multiplexed

AbsoluteJS has WebSocket built in. Adding thin helpers on top makes it the best framework for AI apps with zero additional infrastructure.

**What needs to be built:**

*Server side — `streamAI()` utility:*
```ts
import { streamAI } from 'absolutejs'

app.ws('/chat', {
  message: async (ws, { prompt, conversationId }) => {
    // streamAI connects to the LLM provider, pipes token chunks
    // over the WebSocket, and handles backpressure/cancellation
    await streamAI(ws, {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250514',
      messages: [{ role: 'user', content: prompt }],
      // Optional: called for each token chunk before sending
      onChunk: (chunk) => {
        // Transform, log, filter, or store chunks
        saveToConversation(conversationId, chunk)
        return chunk
      },
      // Optional: called when the stream completes
      onComplete: (fullResponse) => {
        saveMessage(conversationId, fullResponse)
      }
    })
  }
})
```

- `streamAI()` is provider-agnostic — supports Anthropic, OpenAI, and any provider that returns a `ReadableStream` or async iterator
- Handles backpressure — if the client is slow to consume, the server buffers appropriately
- Handles cancellation — if the client disconnects or sends a cancel message, the LLM request is aborted
- Handles errors — if the LLM API errors mid-stream, sends a typed error message to the client
- The `onChunk` callback enables middleware-like processing: content filtering, token counting, database persistence, RAG augmentation

*Provider adapters:*
```ts
// Built-in adapters for common providers
import { anthropic, openai, ollama } from 'absolutejs/ai'

// Each adapter normalizes the provider's streaming API into a common interface
await streamAI(ws, {
  provider: anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
  // or: provider: openai({ apiKey: env.OPENAI_API_KEY }),
  // or: provider: ollama({ baseUrl: 'http://localhost:11434' }),
  model: 'claude-sonnet-4-5-20250514',
  messages,
})
```

- Adapters handle provider-specific auth, endpoints, and stream formats
- Common interface: `{ stream: AsyncIterable<{ type: 'text' | 'tool_use' | 'error', content: string }> }`
- Easy to add new providers — just implement the adapter interface

*Client side — per-framework hooks:*

**React:**
```tsx
import { useAIStream } from 'absolutejs/react'

const Chat = () => {
  const {
    messages,     // Message[] — full conversation history
    send,         // (content: string) => void — send a message
    cancel,       // () => void — cancel current generation
    isStreaming,  // boolean — true while LLM is generating
    error,        // string | null — last error
  } = useAIStream('/chat')

  return (
    <div>
      {messages.map(m => (
        <div key={m.id} data-role={m.role}>
          {m.content}
          {m.isStreaming && <span className="cursor" />}
        </div>
      ))}
      <form onSubmit={(e) => {
        e.preventDefault()
        send(e.currentTarget.input.value)
      }}>
        <input name="input" disabled={isStreaming} />
        {isStreaming
          ? <button type="button" onClick={cancel}>Stop</button>
          : <button type="submit">Send</button>
        }
      </form>
    </div>
  )
}
```

**Svelte:**
```svelte
<script lang="ts">
  import { createAIStream } from 'absolutejs/svelte'

  const { messages, send, cancel, isStreaming, error } = createAIStream('/chat')
</script>

{#each $messages as message}
  <div data-role={message.role}>
    {message.content}
    {#if message.isStreaming}<span class="cursor" />{/if}
  </div>
{/each}

<form on:submit|preventDefault={(e) => send(e.currentTarget.input.value)}>
  <input name="input" disabled={$isStreaming} />
  {#if $isStreaming}
    <button type="button" on:click={cancel}>Stop</button>
  {:else}
    <button type="submit">Send</button>
  {/if}
</form>
```

**Vue:**
```vue
<script setup lang="ts">
import { useAIStream } from 'absolutejs/vue'

const { messages, send, cancel, isStreaming, error } = useAIStream('/chat')
</script>

<template>
  <div v-for="m in messages" :key="m.id" :data-role="m.role">
    {{ m.content }}
    <span v-if="m.isStreaming" class="cursor" />
  </div>
  <form @submit.prevent="send($event.target.input.value)">
    <input name="input" :disabled="isStreaming" />
    <button v-if="isStreaming" type="button" @click="cancel">Stop</button>
    <button v-else type="submit">Send</button>
  </form>
</template>
```

**Angular:**
```typescript
import { Component, inject } from '@angular/core'
import { AIStreamService } from 'absolutejs/angular'

@Component({
  selector: 'app-chat',
  template: `
    @for (m of ai.messages(); track m.id) {
      <div [attr.data-role]="m.role">
        {{ m.content }}
        @if (m.isStreaming) { <span class="cursor"></span> }
      </div>
    }
    <form (submit)="onSubmit($event)">
      <input name="input" [disabled]="ai.isStreaming()" />
      @if (ai.isStreaming()) {
        <button type="button" (click)="ai.cancel()">Stop</button>
      } @else {
        <button type="submit">Send</button>
      }
    </form>
  `
})
export class ChatComponent {
  ai = inject(AIStreamService).connect('/chat')

  onSubmit(e: Event) {
    e.preventDefault()
    const input = (e.target as HTMLFormElement).input as HTMLInputElement
    this.ai.send(input.value)
  }
}
```

*WebSocket message protocol for AI streaming:*
```ts
// Client → Server
type AIClientMessage =
  | { type: 'message', content: string, conversationId?: string }
  | { type: 'cancel' }

// Server → Client
type AIServerMessage =
  | { type: 'chunk', content: string, messageId: string }
  | { type: 'tool_use', name: string, input: unknown, messageId: string }
  | { type: 'complete', messageId: string, usage?: { inputTokens: number, outputTokens: number } }
  | { type: 'error', message: string }
```

*Advanced features:*
- **Tool use / function calling**: When the LLM calls a tool, the server sends a `tool_use` message. The client can display a "searching..." or "running code..." UI. The server executes the tool and feeds the result back to the LLM, continuing the stream.
- **Conversation branching**: The client sends a `conversationId` — the server maintains conversation state and supports branching (edit a previous message, regenerate from a point).
- **Multi-model routing**: `streamAI` could accept a `router` function that picks the model based on the message (simple questions → Haiku, complex → Opus).
- **Token counting**: The `onChunk` callback can count tokens for usage tracking / rate limiting.
- **Reconnection**: If the WebSocket drops mid-stream, the client hook reconnects and requests the remaining content from the server (using the `messageId` as a cursor).

**Design considerations:**
- The AI helpers should be optional — users who don't build AI features never import them and they're tree-shaken from the bundle.
- Provider API keys should come from environment variables, never sent to the client.
- The client hooks manage the WebSocket connection lifecycle — connect on mount, disconnect on unmount, reconnect on drop. Same patterns as the HMR client.
- The message protocol should be extensible — providers may add new message types (images, audio) and the protocol should handle unknown types gracefully.
- SSR: the chat component renders empty on the server (no messages). Conversation history loads on hydration from the server or local storage.

**Files likely involved:**
- New: `src/ai/streamAI.ts` — core streaming utility that pipes LLM responses to WebSocket
- New: `src/ai/providers/anthropic.ts` — Anthropic adapter
- New: `src/ai/providers/openai.ts` — OpenAI adapter
- New: `src/ai/providers/ollama.ts` — Ollama adapter (local LLMs)
- New: `src/react/hooks/useAIStream.ts` — React hook
- New: `src/svelte/createAIStream.ts` — Svelte store-based hook
- New: `src/vue/useAIStream.ts` — Vue composable
- New: `src/angular/ai-stream.service.ts` — Angular service
- New: `types/ai.ts` — message protocol types, provider interface, hook return types
- Package exports: `absolutejs/ai` for server utilities, per-framework exports for client hooks

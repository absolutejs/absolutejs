# File-system router (opt-in): plan

Status: Phase 1 is implemented (React + Svelte, static and `[param]`
segments, typed `load`/`beforeHandle`, dev and production). Explicit
Elysia routes stay the default and the recommended way to build an app; file
routes are an opt-in convenience for apps with many content-shaped pages.

## 1. Where things stood (Step 1 findings)

- **Page discovery is flat.** Every framework's pages are the files directly
  in `<frameworkDirectory>/pages/` (`*.tsx`, `*.svelte`, `*.vue`, `*.html`;
  Angular is the exception with `**/*.ts`). `scanConventions` splits a pages
  folder into page files and `error`/`loading`/`not-found` conventions;
  `generateReactIndexFiles` writes one hydration index per page;
  `compileSvelte` mirrors a source's folder under `generated/svelte/`.
- **The manifest is keyed by basename.** `generateManifest` derives keys
  from the output file's PascalCased basename (`<Name>Index`, `<Name>`,
  `<Name>CSS`, …), and warns on collisions. Two pages with the same
  basename in different folders cannot coexist.
- **The dev server builds pages on demand** (`src/dev/lazyPages.ts`): a
  missing manifest key is mapped back to a page source by name
  (`toDevPageEntry` = PascalCased basename) and built through the normal
  incremental rebuild.
- **Handlers take the page explicitly.**
  `handleReactPageRequest({ Page, index, props, request })` (the component is
  imported by the server bundle), `handleSveltePageRequest({ indexPath,
  pagePath, props })` (the compiled SSR module is imported from the
  manifest path), `handleVuePageRequest({ indexPath, pagePath, headTag,
  props })`, `handleAngularPageRequest(...)`, and
  `handleHTMLPageRequest(path)` / `handleHTMXPageRequest(path)`.
- **Production bundles the user's server entry** (`absolute start` /
  `compile`) with Bun, React external; Svelte/Vue sources are stubbed in that
  bundle and render from their own SSR bundles.
- **Sitemap routes come from source**: `scanRouteRegistrations` parses the
  project's TypeScript for `.get('/literal', …)` calls. Nothing else knows
  the route list ahead of a running server; `absolute routes` asks a dev
  server for `app.routes`.
- **HTML includes** (`src/build/htmlIncludes.ts`): only files directly in
  `html/pages/` are pages; anything in subfolders is a partial or layout.
- `src/plugins/pageRouter.ts` was an empty stub and is gone.

## 2. Key decisions

### 2.1 Opt-in shape: config + generated route module + `fileRoutes()`

```ts
// absolute.config.ts
export default defineConfig({
	reactDirectory: 'src/frontend/react',
	svelteDirectory: 'src/frontend/svelte',
	fileRoutes: true // or { directory: 'routes', output: 'src/routes.gen.ts' }
});

// src/backend/server.ts
import { fileRoutes, prepare } from '@absolutejs/absolute';
import { routeTree } from '../routes.gen';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.use(fileRoutes(routeTree, manifest))
	.get('/api/health', () => 'ok');
```

- `fileRoutes` in the config turns scanning on; the build writes a **route
  module** (default `src/routes.gen.ts`) that the server imports. Every
  build, `absolute dev` start, `absolute typecheck`, and the dev watcher
  (on add/rename/remove) rewrite it, and only when its contents change.
- Why a generated module rather than a runtime directory scan:
  1. **Production bundling.** `absolute start`/`compile` bundle the server
     entry. Route pages and their `.server.ts` modules reached through the
     route module's `import()`s are bundled into the same server, so a route's
     `load` shares module instances (DB pools, caches) with the rest of the
     server. A runtime scan would import sources from disk next to a bundled
     copy of the same modules.
  2. **Types.** The module instantiates each route with its path, page
     module type and server module type, so `tsc` checks `load` against the
     route's params and the page's props (2.4).
  3. **Dev HMR for free.** The module is ordinary server code: when it
     changes, backend HMR re-runs the entry statement that used `routeTree`,
     and the new routes answer without a restart.
- `fileRoutes(routeTree, manifest)` is a functional Elysia plugin. Each
  route is a **real Elysia GET route**, so OpenAPI, the HEAD fallback,
  `absolute routes`, `secureHeaders()` and request context all see it like
  any other route.
- Route folders live **inside each framework directory**
  (`<reactDirectory>/routes/`, `<svelteDirectory>/routes/`), not in
  `pages/`: existing `pages/` keep their meaning (explicit pages, the HTML
  include rule, conventions), and turning file routes on never changes what
  an existing page is.

### 2.2 Conventions

| File (inside a route folder) | Path | Phase |
| --- | --- | --- |
| `index.tsx` | `/` | 1 |
| `about.tsx` | `/about` | 1 |
| `blog/index.tsx` | `/blog` | 1 |
| `blog/[slug].tsx` | `/blog/:slug` (`params.slug: string`) | 1 |
| `[org]/[repo]/issues.svelte` | `/:org/:repo/issues` | 1 |
| `_components/Card.tsx`, `blog/_Card.tsx` | not a route (private) | 1 |
| `blog/[slug].server.ts` | server module for `blog/[slug]` | 1 |
| `*.test.tsx`, `*.spec.tsx` | not a route | 1 |
| `docs/[...rest].tsx` | `/docs/*` (`params.rest: string`, from Elysia's `*`) | 2 |
| `[[lang]]/about.tsx` | `/about` and `/:lang/about` (`params.lang?: string`) | 2 |
| `(marketing)/pricing.tsx` | `/pricing` (group folder left out of the path) | 2 |
| `blog/error.tsx`, `blog/not-found.tsx` | error page and 404 for `/blog/**` (built) | 3 |
| `blog/loading.tsx` | loading indicator for navigations to `/blog/**` (built) | 3 |
| `layout.tsx`, `blog/layout.tsx` | wraps `/**` and `/blog/**` (React, Svelte, Vue, Angular; built) | 2 |

- Unsupported segments and two files claiming one path are **build errors**
  in production and warnings in dev, listing every offending file.
- Precedence between static and param routes at the same depth is Elysia's
  router's (static wins), the same as hand-written routes.
- **The `loading` convention is the soft-navigation indicator (built).**
  It was scanned, compiled and shipped, and read by nothing. It is now
  shown over the live document while a soft navigation is in flight, after
  a 150ms delay so a fast swap does not flash it, and removed when the
  navigation ends. Fetched once per session from `/__absolute/loading`
  rather than inlined into every response, because the per-framework
  scripts a page handler embeds live in seven handlers — inlining would be
  seven edits and bytes on every page for markup most navigations never
  show. A 204 means the app has no convention and the layer stops asking.
  The alternative reading of the name — a Suspense fallback, as in Next —
  would be close to a no-op here: a file route resolves `load` BEFORE
  rendering, so there is no suspended boundary for a fallback to cover,
  and it would only ever show for in-component async.
- **A layout's island persists across the routes under it (built).** With
  `navigation: true`, an island declared once in a layout with a `persist`
  key keeps running while the routes below change: every route under that
  layout renders the same key, which is what the navigation layer matches
  on, so the live element is moved rather than re-created. Leaving the
  layout tears it down, because a key the incoming page does not render is
  deliberately not persisted — the island must not outlive the layout that
  declared it. No new mechanism was needed for this; it is what 4.2 and
  4.3 compose to, and `tests/integration/server/react-route-layouts-browser`
  is the evidence (mount count, destroy flag and carried DOM state, not
  "the island is still on the page", which a re-created one satisfies).
  An automatically derived key is still open: the key is written once, in
  the layout, but it is written.
- **Nested layouts (built: every framework with a component model).**
  Angular wraps them in the page's source, where Svelte and Vue do, and
  for the same reason — one compiled module serves both the server render
  and the client bootstrap, so the two sides cannot disagree about the
  order. What Angular adds is that a template names a component by its
  SELECTOR rather than by a local import name, so the wrap has to read
  each layout's own `@Component` for the selector AND the class, and put
  the class in the page's `imports` (adding an `imports` array when the
  component has none). A layout with no `selector` cannot appear in a
  template at all, so that is reported rather than wrapped around
  nothing, and so is a page with no inline `template` or with more than
  one exported component — a file route holding several is a router host
  with co-located children, and guessing which one the layouts belong
  around would wrap the wrong template as readily as the right one. An
  Angular layout takes its content through `<ng-content />`.
  The wrap is applied **after** `inlineResources`, because a page written
  with `templateUrl` has an inline `template` only once that has run, and
  it is called from TWO places — the AOT staging and the JIT (dev) path —
  which is why the build test asserts the composed markup through both
  servers. The AOT walker follows the imports of the source as written,
  so it visits each layout explicitly; the JIT path scans imports after
  its transforms and follows the injected one by itself.
  HTML and HTMX still report a `layout.<ext>` as a problem: a static page
  has no component model and no render step to compose one with.
- **Nested layouts (built: React, Svelte and Vue).** Vue works the way
  Svelte does — the layouts wrap the page's `<template>` in the SOURCE,
  so one compiled module carries the tree — and the transform is simpler:
  an SFC's template is a single block, so there is no node list to
  rebuild and no `<svelte:…>` equivalent to hoist. A component imported
  in `<script setup>` is available to the template without being
  registered, so the import is all it takes. A page with only a plain
  `<script>` gets a `<script setup>` added beside it, which Vue allows;
  the alternative was editing a `components: {}` option in someone else's
  script. A Vue layout takes its content through `<slot />`.
- **Nested layouts (built: React and Svelte).** Svelte composes them in a
  different place, and had to: its page renders from ONE compiled module
  that the server and the client both load, so the layouts are wrapped
  around the page's markup in the SOURCE and the two sides cannot disagree
  — the opposite of React, where two composition sites have to be kept in
  step. The injected `import` is also what makes a layout compile, since
  compileSvelte discovers a route's children from its imports.
  Two things the transform has to get right: `<svelte:…>` elements are
  hoisted OUT of the wrapper (a wrapped `<svelte:options>` fails to
  compile, and a `<svelte:head>` usually sits between the nodes being
  wrapped), and the generated component name has to start with a capital
  — Svelte reads a lowercase or `_`-prefixed tag as an element and refuses
  it with `tag_invalid_name`, which the unit test could not see and every
  Svelte route in the fixture reported at once.
  A Svelte layout takes its content as `children` and renders
  `{@render children()}`, the ordinary Svelte 5 way.
- **Nested layouts (built, React).** A `layout.<ext>` wraps its own folder
  and everything below it, so a route's chain is every layout from the
  route root down to its own folder, outermost first. A `(group)` folder
  participates like any other, which is most of what groups are for: a
  layout over a set of pages that adds no path segment.
  The chain is composed twice — by `react/fileRoute.ts` for the server
  render and by the generated hydration index — and the two MUST agree.
  They are folded from the right over an outermost-first list; invert one
  and React discards the server tree and re-renders the root, which looks
  correct on screen and throws the server render away.
  **A page under a layout renders a fragment, not a document.** React pages
  here render their own `<html>`, and the outermost layout owns the shell
  once there is one — a page that renders a document under a layout gets
  its `<head>` hoisted and duplicated (two `<title>` tags), which React
  does not treat as an error. Not detected at build time yet.
  HTML and HTMX do not compose layouts, so a `layout.<ext>` in one of
  those route folders is a reported problem rather than a file that is
  silently ignored.
- **Catch-all, optional and group (built).** A `[...rest]` segment has to be
  the last one, because Elysia's `*` matches the rest of the path and
  anything after it would never be reached. Elysia names that param `*`; the
  file named it, so the route is *typed* against `/docs/:rest` while being
  *registered* as `/docs/*`, and the runtime fills `params.rest` in from the
  wildcard (`*` stays readable too). A path that matches with nothing after
  it (`/docs/`) gives an empty string rather than `undefined`, since the type
  says `string`.
  An `[[optional]]` segment is the only kind that makes one file serve more
  than one path: `[[lang]]/about.tsx` registers `/:lang/about` and `/about`,
  longest first, both pointing at one page name — one build, one manifest
  entry, two registrations. It is typed `/:lang?/about`, which
  `FileRouteParams` reads as `lang: string | undefined`, and the run-time
  params check treats optional names as optional, or `load` would be skipped
  on the shorter path and the page would render with no props at all.
  `[[...rest]]` (optional catch-all) is rejected by name rather than as
  stray characters. A `(group)` contributes no segment, so a group as a
  *file* name is rejected: it would serve its parent folder's path, which
  `index` already means.
- **Page names.** Each route page gets a flat page name,
  `Route<PascalPath><hash6>` (e.g. `RouteBlogSlugej2ms2`). The hash is of
  framework + file path, so names are stable as other routes come and go
  and never collide. Because the name is letters and digits only, every
  existing derivation (manifest keys, lazy dev pages, dev indexes, HMR) treats
  the route as a page in `pages/`: React route indexes are generated next to
  page indexes, and Svelte route files compile to `generated/svelte/*/pages/<name>`.

### 2.3 Data and guards: the co-located server module

```ts
// react/routes/blog/[slug].server.ts
import { NotFound } from 'elysia';
import type { FileRouteContext } from '@absolutejs/absolute';

export const beforeHandle = ({ headers, redirect }: FileRouteContext<'/blog/:slug'>) =>
	headers.cookie?.includes('session=') ? undefined : redirect('/login');

export const load = async ({ params }: FileRouteContext<'/blog/:slug'>) => {
	const post = await db.post(params.slug);
	if (!post) throw new NotFound(); // renders the not-found convention

	return { post }; // the page's props
};
```

- `load(context)` returns the page's props (or a `Response`, e.g. a
  redirect). Throwing `NotFound` renders the not-found page; any other error
  renders the framework's error convention or the built-in error page, with
  the cache headers a page error gets.
- `beforeHandle(context)` runs as the route's Elysia `beforeHandle` hook; a
  returned value answers the request.
- `FileRouteContext<Path>`: `params` (typed from the path), `query`,
  `headers`, `request`, `set`, `path`, `redirect(url, status?)`. Request
  params are checked against the path's names at run time before `load` or
  `beforeHandle` sees them.
- **`ssr = false` (built).** A route's server module may
  `export const ssr = false`: the server sends the document shell and the
  browser renders the page. `beforeHandle` and `load` still run on the
  server, so guards, redirects and props are unchanged. A React route's
  page module is then never imported on the server, which is what lets a
  route built on a browser-only library work at all. It does nothing for
  an HTML or HTMX route, and the scan reports it there. See
  docs/CLIENT_ONLY_PAGES.md.
- **Folder guards (built).** A `layout.server.ts` in a route folder exports
  `beforeHandle`, and it runs for every route in that folder and below,
  outermost folder first, before the route's own `beforeHandle`. The first
  one to return a value answers the request. It is found the way a layout
  is, so `(admin)/layout.server.ts` guards a group without adding a path
  segment; it needs no layout component beside it, and every framework's
  route folder may have one, the static ones included. Its context is a
  `FileRouteContext` with untyped params, since one guard serves routes with
  different ones. A `load` exported from it is never called and is reported
  by the scan. See docs/MIDDLEWARE.md.
- App-wide auth stays in Elysia: hooks and plugins registered before
  `.use(fileRoutes(...))` (an `onBeforeHandle`, `@absolutejs/auth`'s
  macros/derive) apply to file routes like any route.
- **Plugin-derived context reaches `load` and `beforeHandle` (built).**
  Whatever the plugins registered before `fileRoutes()` derived onto the
  request is on the context a route sees — `@absolutejs/auth`'s session,
  an `onBeforeHandle`'s own values — and the app types it once by
  declaration merging, as it already does for manifest keys:

  ```ts
  declare module '@absolutejs/absolute' {
  	interface FileRouteDerivedContext {
  		session: Session | null;
  	}
  }
  ```

  Declared rather than inferred, because the generated route module never
  imports the server and so has no Elysia type to infer from. That makes
  it a claim the app makes: a key declared here that no plugin derives
  arrives as `undefined`. Inferring it from the server instead is still
  open.
  The runtime copies every key Elysia did not put there itself, so it is a
  deny-list of Elysia's context keys — measured against Elysia rather than
  guessed, since they differ by version (`body` only on a request that has
  one, `store` and `url` on some versions, `qi` and `~`-prefixed keys
  internal). The keys are filtered before any value is read, because
  `server` is a getter on some versions and copying the whole context
  would invoke it on every request.
  A plugin that derives a key Elysia's context already owns REPLACES it,
  before `fileRoutes()` sees the context — deriving `params` loses the
  route's own params, and no ordering here can put them back. A unit test
  records that rather than guarding against it.
  One limitation worth knowing: augmenting the interface and
  type-checking the framework's own sources in the same program reports
  the context construction, because the framework cannot prove it supplies
  keys the app declared. An app consuming the published declarations never
  sees it.
- **`entries()` and the sitemap (built).** The sitemap is generated from a
  static scan of the project's Elysia registrations
  (`scanRouteRegistrations`), and a file route is not one: `fileRoutes()`
  registers it at run time from the generated module, so nothing in the
  source looks like `.get('/blog/:slug', …)`. A project whose pages were
  all file routes therefore got an EMPTY sitemap — measured on the
  fixture, 20-odd routes and `<urlset></urlset>`.
  A static file route is now listed as its own URL. A dynamic one cannot
  be enumerated from its file name, so its server module may export
  `entries()` returning the param sets, and each becomes a URL:

  ```ts
  export const entries = () => [{ slug: 'hello' }, { slug: 'world' }];
  ```

  It is typed against the route's own params, so a renamed `[slug]` is an
  error here as it is in `load`. A dynamic route WITHOUT `entries()` is
  left out: a sitemap missing a URL is a worse sitemap, but one containing
  `/blog/:slug` is a broken one. A catch-all's value is a path, so its
  slashes survive (`{ rest: 'guide/routing' }` → `/docs/guide/routing`) —
  the same filler `route()` uses, which is why they cannot disagree.
  `entries()` runs in the build's own process and may read a database, so
  a module that throws, or cannot be imported, costs one warning and its
  own route rather than the build. The resolution happens in
  `build/fileRouteSitemapPaths.ts` and reaches the generator as a list of
  URLs, keeping a function whose job is to write XML out of importing
  anyone's server module.
  This is also the `generateStaticParams` equivalent prerendering needs,
  which is why it is an export on the server module rather than a sitemap
  option.
- **Hook for form actions (parallel work, not built here).** The server
  module reserves an `actions` export. When the form-actions runtime lands,
  `fileRoutes()` will register, for a route whose server module exports
  `actions`, a `POST` on the same path that delegates to the form-actions
  dispatcher (`?/name` selection, progressive enhancement, re-render with
  the action result as props). The route module already lazy-loads the
  server module per route, so the only additions are the `actions` key on
  `FileRouteServerModule`, one more registration in `registerRoute`
  (src/core/fileRoutes.ts), and the action result reaching `render`.

### 2.4 Types

The route module calls a typed adapter per route with explicit type
arguments:

```ts
reactFileRoute<'/blog/:slug', typeof import('./react/routes/blog/[slug]'),
	typeof import('./react/routes/blog/[slug].server')>({ … })
```

- The page's props come from the component's type (React) or the `.svelte`
  module's component type (Svelte). `load` must return those props (minus
  `url`, which the handler injects). A page with required props and no
  server module, a `load` returning the wrong shape, and a `load` /
  `beforeHandle` typed for different params (`FileRouteContext<'/blog/:id'>`
  on `blog/[slug]`) are all `tsc` errors in the route module, naming the
  route and the missing property.
- Svelte props are only as precise as the `.svelte` module types the
  project's checker sees: with Svelte's ambient `*.svelte` declaration they
  are loose; `absolute typecheck`'s Svelte declaration mirror (or
  `svelte-check`) makes them exact.
- **Typed links, as `route()` rather than a typed `href` (built).**
  `route('/blog/:slug', { slug })` builds the URL with the path and its
  params both checked. The project's routes are derived from the source
  tree — no build — and written to `.absolutejs/types/routes.d.ts`, which
  merges them into `AbsoluteRouteMap`, exactly as the manifest keys work.
  A project with no file routes gets no declaration, so `route()` accepts
  any path there and nothing existing breaks.

  **Why a function and not a typed `href`.** Because of where links are
  written. The navigation layer intercepts plain `a[href]`, and the example
  app is 76 `<a>` to 1 `<Link>`. React, Svelte and Vue do each have a
  `Link` whose `href` prop a union could check — each framework's own
  checker checks component props, and `absolute typecheck` runs them — but
  those are per-framework router links and a small minority of the link
  sites. Angular's is a directive on a plain `<a>` (`<a absLink href=…>`),
  so its `href` is the native attribute and not checkable at all, and an
  `<a href>` anywhere, or a link in an HTML or HTMX route, is beyond any
  union's reach. A function covers all of it, plus two places a prop
  cannot go: a server module's `redirect`, and a prefetch call.

  Two things were measured into the types, not reasoned into them. The
  path union is written as an indexed access over a mapped type rather
  than `Extract<keyof …, string>`, because only then does TypeScript print
  the project's routes in the error (`'"/blog/:slug" | "/pricing"'`
  instead of `'keyof AbsoluteRouteMap'`). And the params tuple stays
  permissive for a path that is not a route, because a path that is not a
  route still infers as its own literal: without that branch the params
  were computed from the constraint and a typo reported "Expected 2
  arguments, but got 1" without ever naming the path.

  A value with a `/` in it stays a path separator, each part encoded
  separately. That is what a `[...catchAll]` route needs, and the typed
  path cannot say which param is the catch-all one — `[...rest]` and
  `[rest]` are both typed `:rest`. So the rule is uniform, and a `/` in a
  param that was not meant as a catch-all becomes two segments and fails
  to match, rather than being encoded to `%2F` and 404ing invisibly.

  **The other half: the dead-link check (built).** `route()` cannot catch
  a literal typo written straight into an `href`, and no type reaches a
  template or a static `.html`. A scan can read all of them, so
  `build/auditLinks.ts` collects every literal `<a href="/…">` in the
  project's source and reports the ones no route serves — matched against
  the project's file routes and its own Elysia registrations, which
  `scanRouteRegistrations` already extracts for the sitemap.

  **It warns; it does not fail a build.** Both reasons are false positives
  it produced before it existed:

  - A link to a static file. `/assets/ico/favicon.ico` is served by the
    asset plugin, so no route table will ever contain it. Anything with a
    file extension is skipped.
  - A link to a route an installed PLUGIN mounts. `@absolutejs/auth`
    registers its own from inside the package, where a scan of the
    project's source cannot see them, so `/auth/sign-in` looks dead and is
    not. `links.ignore` names those (a trailing `*` matches by prefix),
    and is why this cannot be an error nobody can turn off.

  `absolute links` runs the same check and exits non-zero, so CI can make
  it a gate; the build warning rides along in **production only**, where
  the registration scan is already paid for. That split came from
  measurement: collecting the links costs ~20ms against this repo and the
  registration scan ~1.2s, so adding it to a dev rebuild would cost a
  second per rebuild to find what a production build already reports.

  Two earlier versions of the scan looked right and were not, which is
  what the tests pin: matching any `href=` reported three stylesheet and
  favicon URLs from `<link rel>` elements, and scanning every file
  reported hashed CSS paths out of the project's own `build/` output.

### 2.5 Frameworks and mixing

| Framework | Route files | Rendering | Phase |
| --- | --- | --- | --- |
| React | `<reactDirectory>/routes/**/*.{tsx,jsx}` | `reactFileRoute` → `handleReactPageRequest` | 1 |
| Svelte | `<svelteDirectory>/routes/**/*.svelte` | `svelteFileRoute` → `handleSveltePageRequest` | 1 |
| Vue | `<vueDirectory>/routes/**/*.vue` | `vueFileRoute` → `handleVuePageRequest` (built; see the note below — NOT compileSvelte's flat-name mapping. `headTag` from a `head` export is still open) | 2 |
| HTML / HTMX | `<htmlDirectory>/routes/**/*.html` | `htmlFileRoute` / `htmxFileRoute` → `handleHTMLPageRequest` / `handleHTMXPageRequest` (built). Static segments and `(group)` only; a param is a build error naming the segment. The route tree is copied to `<build>/<dir>/routes` and post-processed exactly like `pages/`, NOT renamed into it — `<abs-include>` resolves against a page's source location, so a flattened route would compute a source path that does not exist and its includes would quietly expand to nothing. A server module may export `beforeHandle`; `load` is not part of the type, because props it returned would have nowhere to go | 2 |
| Angular | `<angularDirectory>/routes/**/*.ts` | `angularFileRoute` → `handleAngularPageRequest` (built). An Angular page takes no props — data reaches it as the page's request context — so a route's `load` returns that context, and the middle type argument is the page's `Context` export rather than a props type. `Context` is type-only, so `typeof import(page)` cannot see it: the generated module writes a type-level `import(page).Context`, and only when the page really exports one, falling back to `Record<string, unknown>`. The compiled server module and index are renamed to the route's page name in place (as Vue's are), because a manifest key comes from an output's file name and `[slug]` would collide across folders | 3 |

- **Mixing frameworks** is one URL space over every framework's route
  folder: `react/routes/blog/[slug].tsx` and `svelte/routes/docs/index.svelte`
  coexist, and the same path from two frameworks is a build error. A single
  shared tree (`src/routes/` with the extension choosing the framework) is a
  later option; it needs every compiler to accept sources outside its
  framework directory, which the flat-name mapping already prepares.
- **Explicit routes take precedence.** A route registered before
  `.use(fileRoutes(...))` makes the file route skip itself (with one warning
  per route); one registered after replaces it, because Elysia keeps the
  last handler for a method and path. Either way the explicit route answers.

### 2.6 Integration

- **HMR (Phase 1, done).** Editing a route page is a normal page edit (React
  Fast Refresh / Svelte HMR through the module server, SSR updated through
  backend HMR). Editing a `.server.ts` applies through backend HMR. Adding,
  renaming or removing a route file rescans (`src/dev/fileRouteRefresher.ts`),
  rewrites the route module, and queues it through the watcher pipeline; the
  entry re-runs `fileRoutes()` and the route answers or 404s without a
  restart. The page itself builds on first request like any lazy dev page.
- **Typecheck (Phase 1, done).** `absolute typecheck` and `absolute dev`
  write the route module first, so a fresh clone type-checks.
- **`absolute routes` (done).** File routes are real Elysia routes, so they
  are listed, and each row names where the route comes from: the route file
  for a file route (`react/routes/plans/pricing.tsx`), the registration call
  for any other (`server.ts:42:3`). `--json` carries it as
  `source: { kind: 'file' | 'call', location }`. Recorded per handler in
  `src/core/routeSources.ts`, so a plugin prefix or group does not lose it. A
  route registered inside a dependency is attributed to the line of the app
  that mounted it.
- **`absolute ls`** lists pages per framework from `pages/`. Phase 2 adds a
  "Routes" group per framework from the route scan.
- **Sitemap (Phase 2).** `scanRouteRegistrations` only finds literal
  `.get('/…')` calls; file routes add their static paths from the scan, and a
  param route can export `entries()` from its server module to enumerate
  concrete paths (also used by prerender).
- **Prerender / ISR (Phase 3).** `static.routes` already renders any served
  path over HTTP, so listed file routes prerender; Phase 3 adds
  `static.routes: 'all'`-style expansion from the route scan plus
  `entries()`, and checks nested-path file naming in `_prerendered/`.
- **`error` and `not-found` per folder (built).** `routes/blog/error.tsx` is
  the error page for every route under `routes/blog/`, and
  `routes/blog/not-found.tsx` their 404. Each is found the way a layout or a
  guard is: from the route's own folder up to the route root, nearest first,
  and each kind on its own, so a folder with an `error` and no `not-found`
  takes its 404 from further up. Failing that, the framework's `pages/`
  conventions apply as before. Every framework's route folder may have them
  (`.tsx`, `.svelte`, `.vue`, an Angular render function in `.ts`, `.html`).
  - **An error page** answers a route whose `load` throws, and one whose
    page throws while rendering.
  - **A not-found** answers two things. A route whose `load` throws
    `NotFound` gets the nearest one above it. An address that no route
    answers gets the one of the deepest folder it falls under:
    `/blog/2024/anything` is answered by `routes/blog/not-found`. A param
    folder stands for one segment (`users/[id]/not-found` covers
    `/users/7/…`), and between two folders as deep, the one that names more
    of the address wins.
  - **A `(group)` folder takes part for its routes.** `(admin)/error.tsx`
    covers the group's routes and no others. Its `not-found` serves those
    routes too, but not unmatched addresses: a group adds nothing to an
    address, so there is no path for it to answer for.
  - **Two frameworks, one folder.** If two frameworks' route folders both
    hold a `not-found` for the same path, an unmatched address under it
    could show either. That is a build error in production and a warning in
    dev, like two files serving one path.
  - A page's own `<Page>.error` file in `pages/` still wins for that page.
  - Only page requests get these pages: a client asking for JSON keeps the
    JSON 404, as with the app-wide conventions.
- **`loading` per folder (built).** `routes/dashboard/loading.tsx` is the
  indicator the navigation layer shows while a soft navigation to an address
  under `/dashboard/` is in flight; the app's own, from `pages/`, is shown for
  anywhere else. The deepest folder the destination falls under wins, by the
  same rule as a folder's `not-found` for an unmatched address.
  - It is chosen by where the navigation is GOING, in the browser, before
    the server is asked anything. So the layer fetches every indicator the
    app has in one request, once per session (`/__absolute/loading`, asked
    for as JSON), and picks among them itself. Visiting ten sections is
    still one fetch.
  - Because it is chosen by address and not by route, a `(group)` folder's
    `loading` has no address of its own and is not used; put it in a folder
    that names a path segment.
  - Two frameworks holding a `loading` for the same folder path is a build
    error in production and a warning in dev.

## 3. Phases and exit criteria

**Phase 1 — React + Svelte, static and `[param]` (done).**
Exit criteria (all met, see section 4):
- `fileRoutes` config, route module generation, `fileRoutes()` plugin,
  `reactFileRoute` / `svelteFileRoute` adapters, typed `FileRouteContext`.
- Production (`absolute build`, `absolute start`): SSR, `load` props in the
  HTML and hydration props, `beforeHandle` redirect, client bundles served,
  explicit routes win in both registration orders, private files ignored.
- Dev: same routes; a route file added while dev runs answers, a removed one
  404s, a `load` edit applies, React and Svelte pages hydrate and hot-update.
- Type errors for a wrong `load` return, wrong params and a missing server
  module.

**Phase 2 — More segments, more frameworks, tooling.**
Exit criteria: ~~`[...rest]`, `[[optional]]`, `(group)` mapped and typed~~
**done**; ~~Vue and HTML/HTMX route folders~~ **done**; ~~sitemap includes
static file routes and `entries()`~~ **done — see 2.3**; ~~`absolute routes` shows route sources~~ **done**; `absolute ls` lists
a "Routes" group per framework (open); ~~typed plugin-derived
context~~ **done**; the `actions` hook wired to the form-actions runtime
(waiting on that runtime, which is parallel work).

**Phase 3 — Angular, conventions, static generation.**
Exit criteria: Angular route folders; ~~per-folder `error` and
`not-found`~~ **done**; ~~per-folder `loading`~~ **done**;
prerender/ISR expansion of file routes; `absolute compile` (standalone
binary) e2e with file routes.

## 4. Phase 1 verification

- Unit: `tests/unit/build/fileRoutes.test.ts` (path mapping, naming, scan,
  conflicts, route module output) and `tests/unit/core/fileRoutes.test.ts`
  (plugin: load props, render input, beforeHandle, load redirect/404/error,
  explicit precedence in both orders, static-over-param).
- Integration: `tests/integration/server/file-routes.test.ts` runs a React +
  Svelte fixture (`tests/helpers/fileRoutesFixture.ts`) under
  `absolute start` and `absolute dev`, including adding and removing route
  files and editing a `load` while dev runs.
- Manual: browser hydration and HMR of React and Svelte route pages, `tsc`
  errors for the three mismatch cases, and a packed-tarball scaffold app
  (`create-absolutejs`) in production and dev.

## 5. Phase 1 limitations

- `absolute compile` (standalone executable) with file routes is untested.
- Island metadata for dev rebuilds (`loadPageIslandMetadata`) only scans
  `pages/`, so editing an island used by a route page may not rebuild that
  page in dev.
- `FileRouteContext` does not carry plugin-derived values (auth sessions)
  yet; use an Elysia hook registered before `fileRoutes()` for app-wide
  guards.
- Svelte route props are type-checked only as precisely as the project's
  `.svelte` module declarations.

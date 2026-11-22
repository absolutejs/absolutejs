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
| `blog/error.tsx`, `blog/loading.tsx`, `blog/not-found.tsx` | conventions for `/blog/**` | 3 |
| `layout.tsx`, `blog/layout.tsx` | wraps `/**` and `/blog/**` (React, built) | 2 |

- Unsupported segments and two files claiming one path are **build errors**
  in production and warnings in dev, listing every offending file.
- Precedence between static and param routes at the same depth is Elysia's
  router's (static wins), the same as hand-written routes.
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
  Svelte, Vue, Angular, HTML and HTMX do not compose layouts yet, so a
  `layout.<ext>` in one of those route folders is a reported problem
  rather than a file that is silently ignored.
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
- App-wide auth stays in Elysia: hooks and plugins registered before
  `.use(fileRoutes(...))` (an `onBeforeHandle`, `@absolutejs/auth`'s
  macros/derive) apply to file routes like any route. Phase 2 passes a typed
  view of derived context values (e.g. the session) into `FileRouteContext`.
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
- **`absolute routes` (Phase 1 works).** File routes are real Elysia routes,
  so they are listed. Phase 2 adds a source column from the route tree.
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
- **Conventions per folder (Phase 3).** `error`/`loading`/`not-found` files in
  a route folder apply to that folder's routes and below, falling back to
  the framework's `pages/` conventions.

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
Exit criteria: `[...rest]`, `[[optional]]`, `(group)` mapped and typed; Vue
and HTML/HTMX route folders; sitemap includes static file routes and
`entries()`; `absolute ls`/`absolute routes` show route sources; typed
plugin-derived context; the `actions` hook wired to the form-actions runtime.

**Phase 3 — Angular, conventions, static generation.**
Exit criteria: Angular route folders; per-folder `error`/`loading`/`not-found`;
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

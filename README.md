# AbsoluteJS

Full‑stack, **type‑safe** batteries‑included platform that lets you **server‑side render _any_ modern front‑end**—React, Svelte, Vue, Angular, plain HTML and HTMX—with a single Bun‑powered build step.

[![bun-required](https://img.shields.io/badge/runtime-bun%401.x-yellowgreen?logo=bun)](https://bun.sh)
[![elysia-required](https://img.shields.io/badge/server-elysia%40latest-blue?logo=elysia)](https://elysiajs.com)
![license](https://img.shields.io/badge/license-BSL--1.1-lightgrey)

---

## Why Absolute JS?

- **Universal SSR.** Bring your favourite UI layer; Absolute JS handles bundling, hydration, and HTML streaming.
- **One build, one manifest.** `absolute dev` and `absolute build` produce a single manifest mapping every page’s client and server assets; `prepare()` hands it to your routes along with the plugin that serves them.
- **End‑to‑end type safety.** A unified source of truth for your types—from the database, through the server, and all the way to the client—so you can be certain of the data shape at every step.
- **Zero‑config philosophy.** Point the build at your folders; sane defaults light up everything else.
- **Plugin power.** Extend with standard Elysia plugins—ship auth, logging, i18n, and more. First‑party: [`@absolutejs/auth`](https://www.npmjs.com/package/@absolutejs/auth) and the `networking` plugin.

---

## Requirements

| Tool       | Version | Purpose                                     |
| ---------- | ------- | ------------------------------------------- |
| **Bun**    | ≥ 1.4.4 | Runtime, bundler, and TypeScript transpiler |
| **Elysia** | latest  | Web server & middleware platform            |

---

## Installation

```bash
bun add @absolutejs/absolute
```

---

## Quick Start

Two files: a config saying where your pages live, and a server that serves
them. The CLI builds from the config, so nothing calls the bundler by hand.

```ts
// absolute.config.ts
import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	assetsDirectory: 'assets',
	buildDirectory: 'build',
	htmlDirectory: 'html',
	reactDirectory: 'react',
	svelteDirectory: 'svelte'
});
```

```ts
// server.ts
import { Elysia } from 'elysia';
import {
	asset,
	handleHTMLPageRequest,
	networking,
	prepare
} from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte';
import { ReactExample } from './react/pages/ReactExample';
import type SvelteExample from './svelte/pages/SvelteExample.svelte';

// Reads the build the CLI produced: the asset manifest, plus the plugin that
// serves those assets.
const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/', () => handleHTMLPageRequest(asset(manifest, 'HTMLExample')))
	.get('/react', () =>
		handleReactPageRequest({
			index: asset(manifest, 'ReactExampleIndex'),
			Page: ReactExample,
			props: { initialCount: 0 }
		})
	)
	.get('/svelte', () =>
		handleSveltePageRequest<typeof SvelteExample>({
			indexPath: asset(manifest, 'SvelteExampleIndex'),
			pagePath: asset(manifest, 'SvelteExample'),
			props: { initialCount: 0 }
		})
	)
	.use(networking);
```

```bash
bunx absolute dev      # build a page on first request, hot-reload edits
bunx absolute build    # production assets
bunx absolute start    # production server
```

`asset(manifest, key)` is checked rather than stringly typed: `absolute dev`,
`absolute build` and `absolute typecheck` derive your project's keys from its
pages and styles and write a declaration, so `asset(manifest, 'Abuot')` is a
type error instead of a 404. The same holds for `route('/blog/:slug', { slug })`
once file routes are on.

---

## The CLI

Installing the package installs an `absolute` binary. `absolute --help` lists
every command and the global flags; these are the ones reached for most:

| Command                                   | Does                                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `absolute dev [entry]`                    | Development server: builds a page on first request, hot-reloads edits, and serves configured mobile targets unless `--no-mobile`                                             |
| `absolute build [--outdir dir]`           | Production assets                                                                                                                                                            |
| `absolute start [entry] [--prebuilt]`     | Production server                                                                                                                                                            |
| `absolute prepare [entry]`                | Build assets and server without launching                                                                                                                                    |
| `absolute compile [entry]`                | Standalone executable                                                                                                                                                        |
| `absolute export [entry] [--to dir]`      | Build, pre-render and assemble a directory for a static host. See [docs/STATIC_EXPORT.md](docs/STATIC_EXPORT.md)                                                             |
| `absolute typecheck`                      | Every framework's own checker, plus manifest keys and `route()` paths                                                                                                        |
| `absolute links`                          | Literal `<a href>` links that no route serves                                                                                                                                |
| `absolute routes`                         | The route table                                                                                                                                                              |
| `absolute doctor [--fix]`                 | Diagnose the project                                                                                                                                                         |
| `absolute scan [--path DIR] [--json]`     | Check source exposure and locked dependencies. Add `--image REGISTRY/IMAGE:TAG` for container advisories. Run `absolute scan --help` for scope, offline mode and exit codes. |
| `absolute migrate [--apply]`              | Coming from another framework: what moves mechanically, what needs you, and the dependencies with a first-party equivalent                                                   |
| `absolute upgrade [--to v]`               | What a newer version of this package costs your code, applying the mechanical migrations                                                                                     |
| `absolute mobile <init \| sync \| …>`     | Capacitor apps and the Expo hybrid shell                                                                                                                                     |
| `absolute db <backup \| restore \| seed>` | Database snapshots, ORM-agnostic                                                                                                                                             |

`--config <path>` works on every command that reads one, and
`absolute --version` prints the installed version.

### Health checks

`GET /__absolute/live` and `GET /__absolute/ready` are on by default with no
configuration — liveness without running any check, readiness running the
checks your app registers with `registerHealthCheck('database', …)` and
answering 503 when one fails. Probing a page instead gets a healthy process
restarted when one page breaks. See [docs/HEALTH.md](docs/HEALTH.md).

### Graceful shutdown

A production server finishes the requests already in flight before it
exits. Without it, a request interrupted by `SIGTERM` reaches the client as
a connection error — on every deploy, every scale-down and every rollout.
Readiness reports `shutting-down` the moment the signal arrives, so a load
balancer stops sending new work; liveness deliberately stays `ok`, since a
failing liveness probe would get the process killed mid-drain. On by
default. If you run behind a load balancer, set `readinessGraceMs`. See
[docs/GRACEFUL_SHUTDOWN.md](docs/GRACEFUL_SHUTDOWN.md).

### Rate limiting

`rateLimit: { limit: 300, rules: [{ limit: 10, path: '/api/upload' }] }`
refuses with `429` and `Retry-After` before a handler runs, counting by
connection address rather than the spoofable `x-forwarded-for`. App routes
are opt-in; the framework's own vitals sink is limited by default and the
health endpoints are never limited by a global limit — a 429 to a readiness
probe takes the process out of rotation. See
[docs/RATE_LIMITING.md](docs/RATE_LIMITING.md).

### Vue app state survives hydration

A Vue page's `setupApp` runs on both sides, so a project could already
install Pinia — but the store **state** never crossed: Pinia fills its
stores during the server render, the browser makes a fresh instance, and
every store resets on mount. `ctx.transferState('pinia', () => pinia.state.value)`
on the server and `pinia.state.value = ctx.restoredState('pinia')` on the
client carry it over. A channel rather than Pinia support, since the
framework doesn't depend on Pinia and the same two calls serve any store.
See [docs/VUE_APP_STATE.md](docs/VUE_APP_STATE.md).

### Vue islands fetch their data on the server

`useServerData` reads its collector off Vue's SSR context, and only the Vue
_page_ handler ever created one — so a Vue island on a React, Svelte or HTML
page rendered its pending state and the browser fetched after hydration: a
loading flash, and a round trip for data the server already had. Islands now
get a collector of their own, one per request and shared by every Vue island
on the page, and their results are written to the same
`window.__ABSOLUTE_SERVER_DATA__` a Vue page writes — so the browser build of
the hook needed no change at all. A page with no Vue islands writes nothing.

### Angular pages keep their scroll position

A page that exports `routes` gets a router configured with
`withInMemoryScrolling`, so going back restores where the visitor was and
a `#fragment` scrolls to its anchor. Angular's router does neither on its
own — measured in a browser on a routed page, scrolling to 1500, navigating
and going back left the position at **0**; it now returns to **1500**. The
framework's own cross-framework navigation layer always restored scroll,
which made Angular pages the odd ones out inside the same app. Turn it off
with `angular: { router: { scrollRestoration: false } }`, and opt into
preloading every lazy route with `{ preloading: 'all' }` — off by default,
since that spends bandwidth a visitor may never use.

### A render that hangs still answers

`rendering: { timeout: 30000 }` (the default) bounds a page render. Without
it a React Suspense boundary that never resolves streams its shell and then
nothing — measured on a real server, the request never completed and the
document had no closing tag, until Bun's `idleTimeout` reaped the socket
_with no error_ four minutes later. With the budget the same page answered
in 1.6s with a complete document and the boundary's fallback in place,
because React treats an abort properly: it flushes each pending boundary's
fallback and closes. Set `false` to leave renders unbounded. Streaming
slots are bounded separately, five seconds per slot. See
[docs/RENDER_TIMEOUT.md](docs/RENDER_TIMEOUT.md).

### A dev toolbar that knows about islands

While `absolute dev` runs, a pill in the corner opens a panel showing what
the page is made of: which framework rendered it, and every island with
its component, framework, hydrate strategy and persist key — the one view
React DevTools and Vue DevTools structurally cannot give you, since each
sees only its own framework. Plus recent HMR updates with their files and
durations, and the routes and requests `absolute routes` and
`absolute inspect` read. `shift`+`alt`+`D` toggles it. Dev only; a
production build does not include it. See
[docs/dev/dev-toolbar.md](docs/dev/dev-toolbar.md).

### What a bundle is made of

`absolute analyze --modules` breaks a build down by the modules inside it,
and `--treemap sizes.html` writes the same data as a self-contained SVG
treemap. The category totals it already printed answer "how big" and never
"of what": the first run of this on the example app found
`@angular/compiler` at 462 KB, 68% of everything shipped to a browser.
Bytes are attributed from sourcemaps — 96.9% of a 3.9 MB bundle across
1,325 sources, with the bundler's own glue reported as unmapped rather
than quietly dropped. Needs `sourcemaps: 'external'`, and says so when
there are none. See [docs/BUNDLE_TREEMAP.md](docs/BUNDLE_TREEMAP.md).

### Typed environment variables

`defineEnv({ PORT: Type.Number({ default: 3000 }) })` returns a typed,
frozen object and stops the process at startup with a table — not a stack
trace — when a variable is missing or the wrong type, printing a
secret-looking name as `set` rather than its value. `absolute env` now
lists what the project DECLARES (type, default, optional) alongside what it
reads with `getEnv()`, and `--check` fails on a variable set to the wrong
thing rather than only on an absent one. Two things were broken before
this: a schema naming a string format could never pass, because TypeBox
registers no format validators and fails closed, and `absolute env` could
not see a schema at all. See [docs/TYPED_ENV.md](docs/TYPED_ENV.md).

### Third-party scripts

`<Script src="https://plausible.io/js/script.js" />` (React), or
`scripts: [{ src: … }]` on any page's head, loads a third-party tag with a
strategy — `beforeInteractive`, `afterInteractive` (deferred, the default)
or `lazyOnload`, added after the window loads. Each tag carries an
identity, so it runs ONCE however the visitor moves: a soft navigation
recreates the incoming page's scripts, and before this a tag two pages
shared re-ran on every navigation — measured, an analytics counter reading
1, then 2, then 3. Angular reaches a script only through the head, because
its template compiler drops a `<script>` element silently. See
[docs/THIRD_PARTY_SCRIPTS.md](docs/THIRD_PARTY_SCRIPTS.md).

### Render tracing

`registerTracer(tracerOrNoop(provider, 'app'))` emits OpenTelemetry spans
for a page render and for the ETag-and-compression phase after it, with the
framework, page and matched route pattern as attributes. No dependency on
`@absolutejs/telemetry` or `@opentelemetry/api` — the tracer type is a
structural subset of both — and no measurable cost with none registered.
See [docs/TRACING.md](docs/TRACING.md).

### Error reporting

`onServerError((report) => …)` is notified of every server-side render
error — which framework, whether the response had already started
streaming, and the request id the access log line carries. Previously these
went to `console.error` and nowhere else. Hand them to
[`@absolutejs/errors`](https://www.npmjs.com/package/@absolutejs/errors),
the ecosystem's exception capture, or anywhere else; a page handler catches
its own render failure to serve `error.html`, so an Elysia-level `onError`
never sees these. See
[docs/ERROR_REPORTING.md](docs/ERROR_REPORTING.md).

### Request logging

`logging: { requests: 'json' }` writes one line per request — method, path,
status, duration and a correlation id — as JSON for a log pipeline, or
`'text'` for a terminal. An inbound `x-request-id` is adopted so a trace
spans the proxy and this process, and `getCurrentRequestId()` returns the
current request's id anywhere inside it. Off by default; batched, which
costs about 2.5% of throughput rather than 12%. See
[docs/LOGGING.md](docs/LOGGING.md).

### Benchmarks and regression gates

`absolute bench` measures what this project costs — bundle size and build
time per framework, and server-render throughput per page — and
`--check` fails when any of it gets worse than a baseline you commit:

```ts
// absolute.config.ts
export default defineConfig({
	// …
	bench: {
		pages: [
			{ label: 'react', path: '/react' },
			{ label: 'svelte', path: '/svelte' }
		],
		serverEntry: 'server.ts'
	}
});
```

```bash
absolute bench --save    # record .absolute-bench-baseline.json, then commit it
absolute bench --check   # in CI; exits non-zero on a regression
```

`pages` has no default because only your server knows which path renders
which framework. Without it, bench reports sizes and build time and skips
throughput.

Two tolerances, because the measurements are not alike. **Bundle sizes are
deterministic** — the same input gives the same bytes anywhere — so they
default to `sizeTolerance: 1.05`. **Build time and throughput move with CPU
contention and thermal state**, so they default to `timeTolerance: 1.25`
and the throughput pass takes a warmup window it throws away. Gating a wall
clock as tightly as a byte count is how a benchmark gate becomes the flaky
job everyone reruns until it passes.

Improvements are never reported: a build that got faster should not need
anyone to dismiss a warning about it.

### Size budgets

`absolute analyze` prints what the build weighs, by category, and diffs it
against a baseline you save with `--save`. To make a size a build rule
rather than something you remember to look at, declare budgets in the
config and run `absolute analyze --check` in CI — it exits non-zero when
something is over:

```ts
// absolute.config.ts
export default defineConfig({
	// …
	sizeBudgets: {
		categories: { 'Shared chunks': '600kb', Hydration: '150kb' },
		perEntry: '500kb',
		total: '4mb'
	}
});
```

Category names are the ones `analyze` prints. `perEntry` is what catches a
single page that has quietly become enormous, where a total would absorb
it. Budgets that are met are printed too, so a passing gate is
distinguishable from one that never ran.

`absolute ls --sizes --budget 50kb` remains the quick interactive check of
one number against every page.

### The dev error overlay

A build error shows the lines around it, numbered, with a caret on the
column — and the file path above it is a button that opens the file at that
line in your editor. Set the command once:

```bash
ABSOLUTE_EDITOR=cursor   # or code, subl, webstorm, nvim, emacs…
```

`$LAUNCH_EDITOR` and `$EDITOR` are used as fallbacks, in that order.
`ABSOLUTE_EDITOR` exists so you can point this at a GUI editor without
changing `$EDITOR`, which also drives git. With none of them set, the button
says so rather than guessing at an installed editor.

### Testing your app

`@absolutejs/absolute/testing` boots your project the way the CLI does,
waits for it, and tears it down:

```ts
import { afterAll, expect, test } from 'bun:test';
import { fetchPage, startProject } from '@absolutejs/absolute/testing';

const app = await startProject({
	mode: 'production', // or 'development', for hot reload
	projectRoot: import.meta.dir,
	serverEntry: 'server.ts'
});

afterAll(async () => {
	await app.kill();
});

test('serves the home page', async () => {
	const { html, status } = await fetchPage(`${app.baseUrl}/`);

	expect(status).toBe(200);
	expect(html).toContain('<h1>');
});
```

`startProject` runs the `absolute` binary **your project has installed**,
from your project directory, on a port the OS says is free. `kill()` throws
if anything is still listening afterwards, because a leaked server holding a
port fails the _next_ test rather than the one that caused it.

Also exported: `waitForServer` for a server you start yourself,
`getAvailablePort`, and a file-mutation registry for testing hot reload —
`mutateFile`, `mutateFileInPlace` (an in-place write, which a watcher sees as
a `change` rather than a `rename`), `createFile`, `renameFile`, and
`withFileMutation`, which puts the file back even when the assertion inside
throws. `restoreAllFiles()` in an `afterEach` returns the tree to what git
has, whatever happened.

The browser helpers are deliberately not here: they need Playwright, and a
test harness should not make a browser a dependency of the framework.

### Telemetry

**Off unless you turn it on.** Nothing is sent until you run
`absolute telemetry enable`, which writes `~/.absolutejs/telemetry.json`
with a random ID. `absolute telemetry status` says where it stands and
`absolute telemetry disable` turns it back off.

When it is on, a build, a dev-server rebuild or a CLI command may post to
`absolutejs.com`: the event name, that random ID, the package version, your
OS, architecture and Bun version, a timestamp, and a few fields about the
event — which frameworks a build covered, which pass failed, and **the error
message itself**, which can contain paths from your machine. There is no
account, no IP-based identity and no source code.

Two environment variables keep it off whatever the saved setting says:

```bash
DO_NOT_TRACK=1     # the cross-tool convention; any CLI should respect it
TELEMETRY_OFF=1    # this project only
```

Either one is checked before the config is read, so an opt-out costs no file
read and no request.

---

## How it works

1. **The CLI builds.** `absolute dev` builds a page the first time it is
   requested and rebuilds on edit; `absolute build` builds everything. Both read
   `absolute.config.ts`, scan each framework directory and write a **manifest**
   mapping every page to its server and client assets.
2. **`prepare()` reads that build** and returns the manifest together with the
   `absolutejs` plugin, which serves the compiled assets — including the
   pre-compressed copies and the immutable cache headers for hashed files.
3. **Page handlers render.** `handleReactPageRequest`, `handleSveltePageRequest`
   and the rest take the manifest paths, server-render the page, serialize its
   props for hydration and stream the HTML.

Calling `build()` yourself, from `@absolutejs/absolute/build`, is still
supported and is what the CLI does internally — but a project does not need to.

### Type-checked Svelte page props

`handleSveltePageRequest<typeof Page>({ props })` checks `props` against the
component's `$props()` type, like `handleReactPageRequest`. `absolute typecheck`
generates a declaration per Svelte component with svelte2tsx
(`bun add -d svelte2tsx`), and `absolute dev` keeps them current. To see the
same errors in your editor, add the declarations to `rootDirs`:

```jsonc
// tsconfig.json
{
	"compilerOptions": {
		"rootDirs": [".", ".absolutejs/types/svelte"]
	}
}
```

### Svelte `{#await}` and streaming

A plain `{#await}` works as it does in Svelte: the server renders the pending
branch, then the browser resolves the promise and hydrates, so components,
`{#if}` and event handlers work in every branch.

To have the server resolve the promise and stream the result into the page
instead, put `<!-- absolute:stream -->` directly before the block and render
the page with `collectStreamingSlots: true`:

```svelte
<!-- absolute:stream -->
{#await loadPrices()}
	<p>Loading prices…</p>
{:then prices}
	<p>{prices.length} prices, from {prices[0].source}</p>
{:catch error}
	<p>Prices are unavailable: {error.message}</p>
{/await}
```

A streamed block's branches are sent as HTML, so they may contain elements and
`{expressions}` only. A component, `{#if}`, `{#each}` or `{@html}` in a branch
is a build error. A page that streams a block isn't hydrated, so use it for
content that needs no interactivity.

### Partial prerendering

On a route listed in `static.routes`, mark the streaming slots that depend on
the request as `dynamic`. The build pre-renders the rest of the page as a
static shell, with every other slot resolved into it. Each request then gets
the cached shell immediately, even before the route handler runs, and only
the dynamic slots are rendered and streamed into it:

```tsx
<StreamSlot
	dynamic
	id="greeting"
	fallbackHtml="<p>…</p>"
	resolve={() => greet(user)}
/>
```

In Svelte, use the `dynamic` prop or `<!-- absolute:stream dynamic -->`. Svelte
pages need `collectStreamingSlots: true`; React pages collect streaming slots
by default (pass `collectStreamingSlots: false` to turn it off). The shell's page props are captured
at build time, so per-user data belongs in dynamic slots. Works for React
and Svelte pages today. See `docs/PARTIAL_PRERENDERING_PLAN.md`.

### Svelte router: guards, lazy routes and scroll restoration

`<Router>`, `<Route>` and `<Link>` from `@absolutejs/absolute/svelte/router/*.svelte`
route inside one Svelte page. Routes can be guarded and lazily loaded, and
the router manages the scroll position:

```svelte
<script lang="ts">
	import Router from '@absolutejs/absolute/svelte/router/Router.svelte';
	import Route from '@absolutejs/absolute/svelte/router/Route.svelte';
	import Link from '@absolutejs/absolute/svelte/router/Link.svelte';
	import {
		beforeNavigate,
		redirect
	} from '@absolutejs/absolute/svelte/router';

	let { url }: { url?: string } = $props();

	// Browser only: runs before every Link click, goto() and back/forward.
	beforeNavigate(({ type }) => {
		if (type === 'popstate' && hasUnsavedChanges()) return false;
	});
</script>

<Router {url}>
	<Link to="/app/editor/1">Editor</Link>

	<Route
		path="/app/admin"
		guard={({ request }) => {
			// Runs in the browser and during the server render.
			if (!isAdmin(request)) throw redirect('/app/login');
		}}
	>
		{#snippet content()}<AdminPanel />{/snippet}
	</Route>

	<Route path="/app/editor/:id" loader={() => import('./Editor.svelte')}>
		{#snippet pending()}<p>Loading the editor…</p>{/snippet}
		{#snippet error(reason, retry)}<button onclick={retry}>Retry</button
			>{/snippet}
	</Route>
</Router>
```

- **Guards** (`guard` on a `<Route>` or `<Router>`, plus `beforeNavigate`) can
  be async and return nothing to allow, `false` to cancel, or a URL /
  `redirect()` to redirect. They run for `<Link>` clicks, `goto()` and
  back/forward; cancelling a back/forward puts the URL back. Route and Router
  guards also run during the server render, where a redirect is a real 302
  (and a cancel a 403); they get the request as `request`.
- **Lazy routes** (`loader`) are split into their own chunk, loaded when the
  route is first needed or when a `<Link>` to it is prefetched (hover /
  viewport). The server awaits the loader, so the HTML holds the real
  component, and the browser loads the chunk before hydrating, so there is no
  pending flash. `pending` shows while a client-side navigation waits for the
  chunk. The component gets the route params (and `props`) as props.
- **Scroll**: while a router is mounted it sets
  `history.scrollRestoration = 'manual'`, starts new navigations at the top
  (or at the `#hash` target), and restores the position on back/forward and
  reload. `goto(url, { noScroll: true })` or `<Link noScroll>` leaves the
  scroll alone.

### Vue router pages

A Vue page that exports `routes` becomes a single-page app shell. The page
installs vue-router with those routes, and one server route can serve every
child URL:

```vue
<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';

export const routes = defineRoutes([
	{
		path: '/app/one',
		component: () => import('./One.vue').then((m) => m.default)
	},
	{ path: '/app', redirect: '/app/one' }
]);
</script>

<template><RouterView /></template>
```

Forward `request` to `handleVuePageRequest` so the handler can match the URL.
The server sends an empty `#root` for these pages, with the child
routes' CSS already inlined, and the browser renders the route when it mounts.
Rendering on the server would be thrown away by that client mount and would
play CSS entrance animations twice. A page with `client: 'none'` has no client
mount, so it is rendered on the server.

Route parameters may disappear before the outgoing page unmounts. Use
`useRouteParam(() => route.params.matchId)` or `getRouteParam(route.params.matchId)`
from `@absolutejs/absolute/vue` and handle the `string | undefined` result.
See [route parameter safety](docs/VUE_ROUTE_PARAMETERS.md) for navigation,
cancellation and compiler configuration guidance.

### Vue server data

`useServerData(key, fetcher)` loads data while a Vue page renders on the
server and sends it with the page, so hydration reuses it instead of fetching
again. A client-side route change, or a page whose data wasn't loaded on the
server, fetches in the browser. `data` is typed from the fetcher:

```vue
<script setup lang="ts">
import { useServerData } from '@absolutejs/absolute/vue';

const { data, error, pending, refresh } = useServerData('posts', loadPosts);
</script>
```

Keys must be unique within a request, and results must be JSON-serializable. A
fetcher that throws on the server renders an error state instead of failing
the page. See [docs/VUE_SERVER_DATA.md](docs/VUE_SERVER_DATA.md).

### File routes (opt-in)

Routes are explicit Elysia calls by default. For React and Svelte pages you
can opt into file routes instead: with `fileRoutes: true` in
`absolute.config.ts`, every file under `<reactDirectory>/routes/` or
`<svelteDirectory>/routes/` is a GET route.

```
react/routes/index.tsx            → /
react/routes/blog/index.tsx       → /blog
react/routes/blog/[slug].tsx      → /blog/:slug
react/routes/blog/[slug].server.ts  (load + beforeHandle for that route)
react/routes/_components/Card.tsx   (private: `_` files are not routes)
```

```ts
// react/routes/blog/[slug].server.ts
import type { FileRouteContext } from '@absolutejs/absolute';

export const load = ({ params }: FileRouteContext<'/blog/:slug'>) => ({
	post: getPost(params.slug)
});
```

The build writes `src/routes.gen.ts` (`fileRoutes.output` to move it); serve
it with `.use(fileRoutes(routeTree, manifest))`. It type-checks each `load`
against its route's params and its page's props. Explicit routes win over a
file route for the same path, and `absolute dev` picks up added or removed
route files without a restart. See
[docs/FILE_ROUTER_PLAN.md](docs/FILE_ROUTER_PLAN.md).

### Layouts and partials for HTML pages

HTML and HTMX pages can share headers, footers and layouts with build-time
includes:

```html
<!-- html/pages/About.html -->
<abs-include src="../layouts/base.html">
	<template slot="head"><title>About us</title></template>
	<h1>About us</h1>
	<abs-include src="../partials/team.html"></abs-include>
</abs-include>
```

The layout puts the content where its `<abs-slot>` and
`<abs-slot name="head">` tags are. Only files directly in `pages/` are
pages, so keep partials and layouts in folders like `html/partials/`.
Islands, asset links and images inside included markup are handled like a
page's own, and in dev, editing a partial updates every page that uses it.
See [docs/HTML_INCLUDES.md](docs/HTML_INCLUDES.md).

### Islands on HTML and HTMX pages

Static HTML and HTMX pages can embed components of any framework as islands.
Register the components once:

```ts
// src/islands/registry.ts
import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { PriceChart } from './PriceChart'; // React
import Ticker from './Ticker.svelte';

export const islandRegistry = defineIslandRegistry({
	react: { PriceChart },
	svelte: { Ticker }
});
```

```ts
// absolute.config.ts
export default defineConfig({
	htmlDirectory: 'src/html',
	islands: { registry: 'src/islands/registry.ts' },
	svelteDirectory: 'src/svelte' // needed to compile Svelte islands; same for Vue
});
```

Then place islands in a page with `<absolute-island>` (or the `<island>` alias):

```html
<absolute-island
	framework="react"
	component="PriceChart"
	hydrate="idle"
	props='{"symbol":"BTC"}'
></absolute-island>
```

Islands are server-rendered at build time. With `islands.registry` set, the
build also generates an islands bootstrap, and `handleHTMLPageRequest` /
`handleHTMXPageRequest` inject it into any page that contains islands. Each
island's code loads only when that island hydrates:

| `hydrate`                         | when                                                     |
| --------------------------------- | -------------------------------------------------------- |
| `load` (default)                  | as soon as the runtime sees it                           |
| `idle`                            | on an idle callback                                      |
| `visible`                         | when it scrolls into view                                |
| `interaction`                     | on the first pointer, touch, focus or key press on it    |
| `{ media: '(min-width: 48rem)' }` | while the query matches, and later if it starts matching |
| `none`                            | never — server HTML only                                 |

`interaction` is for something heavy nobody has reached for yet — a date
picker, a rich editor, a map — where `visible` already pays the moment it
scrolls past. `media` is for a widget that belongs to one layout and not
another, where `visible` pays for it even on the layout that hides it; it
hydrates later if the window crosses the breakpoint, rather than only
checking at first paint. A `hydrate` value that is none of these hydrates
immediately and says so in dev, instead of silently behaving like `load`.

To run your own client code, point `islands.bootstrap` at a file that calls
`startIslands`. The file can have any name, and it replaces the generated one:

```ts
// src/islands/main.ts  →  islands: { registry: '…', bootstrap: 'src/islands/main.ts' }
import {
	createIslandManifestResolver,
	startIslands
} from '@absolutejs/absolute/client';

startIslands({
	registry: {},
	// Loads each island's chunk from the manifest the server injects.
	resolveComponent: createIslandManifestResolver()
});
```

If a page has islands but the build produced no bootstrap, the dev server logs
a warning instead of serving islands that never hydrate.

### Security headers and CSP

`secureHeaders()` adds a strict Content-Security-Policy with a fresh nonce
per request, plus `X-Content-Type-Options`, `Referrer-Policy`,
`frame-ancestors` and `Permissions-Policy`:

```ts
export const server = new Elysia().use(secureHeaders()).use(absolutejs);
```

Scripts run only with the nonce (`'strict-dynamic'`, no `'unsafe-inline'`),
and every inline script and style AbsoluteJS writes carries it, for every
framework, including streaming slots, islands, pre-rendered pages and the dev
HMR client. Use `getCspNonce()` for your own inline scripts. See
[docs/SECURITY_HEADERS.md](docs/SECURITY_HEADERS.md).

### Web vitals

Turn on `vitals` to report LCP, INP, CLS, FCP and TTFB from real visits:

```ts
// absolute.config.ts
vitals: {
	sampleRate: 0.25;
}
```

Every page then loads a small reporter that sends one batch per page, with
its route, to `POST /__absolute/vitals`. Those reports are aggregated into
per-route 75th percentiles — the statistic Core Web Vitals is assessed at —
and served as JSON:

```
GET /__absolute/vitals/summary
```

On in dev; off in production unless `summary: true`, because it is an
unauthenticated read of every route that reported and how slow it is. For a
real metrics backend, `onVital((report) => …)` receives every metric and
exposes nothing. `vitals` is off by default, and off in dev unless
`dev: true`. See [docs/WEB_VITALS.md](docs/WEB_VITALS.md).

### Installable PWA and offline Sync

Enable the web-app shell once in `absolutejs.config.ts`. AbsoluteJS generates a
single shared browser bootstrap, service worker, and optional manifest, then
wires them into React, Vue, Svelte, Angular, HTML, HTMX, and island client
entries. Route and page code does not change.

```ts
import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	// Existing framework directories and build settings...
	pwa: {
		manifest: {
			name: 'Acme',
			shortName: 'Acme',
			themeColor: '#111827',
			icons: [
				{
					src: '/icons/app-512.png',
					sizes: '512x512',
					type: 'image/png'
				}
			]
		},
		serviceWorker: {
			offline: {
				fallback: '/offline.html',
				assetPrefix: '/assets/'
			}
		},
		// With @absolutejs/auth + syncSocket(), this provisions the existing
		// HTTP-only web session and durable IndexedDB transport automatically.
		sync: true,
		// Optional: importing pushNotifications enables this automatically.
		// The public key defaults to VAPID_PUBLIC_KEY at build time.
		push: true
	}
});
```

The default outputs are `/sw.js`, `/manifest.webmanifest`, and the internal
shared bootstrap at `/__absolute/pwa/bootstrap.js`. Put referenced icons and the
offline fallback in `publicDirectory`. The worker uses Background Sync when the
browser offers it, while online/focus/visibility resume remains the correctness
path. Native Capacitor clients continue to use their Bearer and SQLite
transport; no web cookie or token is copied into the worker.

Portable push uses the same `pushNotifications` API in the browser and a
Capacitor shell. AbsoluteJS generates Web Push registration and subscription
rotation against the same-origin `/auth/push` route. Configure the trusted
server once with `auth({ push: { registrar, tenant, topics } })`; Auth derives
identity, tenant, and authorized topics, while page code never receives APNs,
FCM, or Web Push credentials. Only the public VAPID key enters browser output;
keep `VAPID_PRIVATE_KEY` in the server-side Dispatch sender.

`@absolutejs/pwa/client` also exposes `onPwaSyncResult()` and
`getLastPwaSyncResult()` (plus the `absolute:pwa-sync-result` DOM event) for
application-owned diagnostics. Results contain only success, duration, trigger,
and aggregate counts—never credentials, namespaces, endpoints, arguments, or
rows. Account changes are re-resolved before focus/online/visible Sync and the
old worker run is aborted and cleared before the new namespace can run.

AbsoluteJS also generates one local-storage migration bundle for web and native
from the app plus installed Sync packs. Routes stay unchanged. A package that
owns persisted data declares its JSON-safe evolution in `package.json`:

```json
{
	"absolutejs": {
		"sync": {
			"localSchema": {
				"version": 2,
				"migrations": [
					{
						"toVersion": 2,
						"operations": [
							{
								"type": "set-default",
								"collection": "tasks",
								"field": "completed",
								"value": false
							}
						]
					}
				]
			}
		}
	}
}
```

Absolute derives stable component IDs from package names, keeps independent
version ledgers, validates migration gaps during build/doctor, and applies the
same transaction atomically in IndexedDB or Capacitor SQLite before Sync starts.
The same `localSchema` object can declare `localData` rules for sensitivity,
encryption, memory-only fallback, whole-cache retention, eviction priority, and
per-principal quota. Absolute mobile stores record payloads as AES-256-GCM
ciphertext using a random key held by Keychain/Keystore; native background Sync
uses the identical authenticated format. Browsers without an audited key
provider either keep a declared fallback in memory only or fail closed. Pending
mutations are never evicted to satisfy quota.

App updates are consent-driven: `onUpdateAvailable()` latches a waiting worker
for late UI subscribers, `checkForUpdate()` performs a passive check, and
`applyUpdate()` activates and reloads only after the user accepts. AbsoluteJS
does not silently replace a running application session.

### Native device capabilities

Application code uses one provider-neutral API in web pages and Capacitor apps:

```ts
import {
	camera,
	clipboard,
	haptics,
	keyboard,
	photos,
	share,
	systemBars
} from '@absolutejs/devices';

await clipboard.writeText('Copied everywhere');
await share.share({ text: 'Shared everywhere', url: 'https://absolutejs.com' });
await haptics.impact('light');
const removeKeyboard = await keyboard.onChange(({ visible, heightPx }) => {
	document.documentElement.style.setProperty(
		'--keyboard-height',
		visible ? `${heightPx}px` : '0px'
	);
});
await systemBars.setAppearance('light', 'status');
const permission = await camera.requestPermission();
if (permission.state === 'granted') {
	const capture = await camera.takePhoto();
	image.src = capture.webPath;
}
const chosen = await photos.pick({ limit: 1 });
```

`absolute mobile init` and `absolute mobile sync` discover these named value
imports, read the tested mappings published by `@absolutejs/devices-capacitor`,
and offer to install only the exact Capacitor plugins in use. The generated
shell wires them into the shared device facade; users do not import Capacitor,
edit Swift/Kotlin, or maintain native bootstrap code. Type-only imports and test
sources do not provision plugins. `absolute mobile doctor release` rejects a
missing or mismatched plugin before release.

Run `absolute mobile inspect` from an application root for a read-only summary
of the effective mobile config, runtime package versions, discovered
capabilities/plugins, native-project state, embedded routes/frameworks, bundle
validation, and release projection. Add `--json` for a redacted CI or support
artifact; it omits credentials, device/account identifiers, absolute paths, and
detailed doctor messages. See [mobile project inspection](docs/MOBILE_INSPECT.md).

Configure one typed source for native icons, Android adaptive/themed layers,
iOS appearance variants, and launch artwork, then run `absolute mobile assets
--preview`. AbsoluteJS projects it into either Capacitor or Expo, detects stale
inputs, and includes the result in release doctor. See
[mobile branding and native assets](docs/MOBILE_BRANDING.md).

Before signing, run `absolute mobile doctor release`. It validates pinned and
aligned Capacitor packages, dependency locking, HTTPS and signed-link identity,
packaged app identity, SHA-256 page/style integrity, runtime compatibility, CSP,
native deep-link projections, privacy/permission projections, debug residue,
and Sync/device policy. Its `--json` output is a redacted format-versioned CI
artifact containing public app facts, check IDs/statuses, totals, and explicit
manual-review categories—never local paths or detailed failure text. See the
[Capacitor mobile threat model](docs/MOBILE_SECURITY_THREAT_MODEL.md).

Generate protected GitHub Actions for cryptographic pull-request validation,
signed AAB/IPA builds, and optional Google Play/TestFlight publication:

```sh
bunx absolute mobile ci github server.ts --publish
```

The generated workflow keeps signing and provider credentials behind the
`absolute-mobile-release` GitHub environment. See
[mobile CI and store releases](docs/MOBILE_CI.md).

After testing the immutable Android or iOS release, bind its exact artifact and
runtime identity to the installed, Simulator, device, or store evidence with
`absolute mobile certify`. The content-addressed result can be checked again in
CI without credentials or native tooling, then supplied to `mobile ci promote
<platform> --run-id ... --certification ...` so a protected follow-up workflow
restores the exact prior-run artifact, adds GitHub OIDC/Sigstore provenance, and
publishes without rebuilding. Production channels require installed Android and
store-delivered iOS evidence by default; production Google Play requires
installed evidence. See
[mobile release certification](docs/MOBILE_RELEASE_CERTIFICATION.md).

An experimental Expo Router hybrid is also available behind
`mobile.engine: 'expo'`. Explicit React Native routes use native UI while every
unclaimed AbsoluteJS route remains an embedded, signed web route regardless of
framework. Capacitor is still the default; Expo Android now supports audited,
signed production AABs, generated CI, and Google Play publishing while Expo iOS
release automation remains experimental. See the
[Expo hybrid experiment](docs/MOBILE_EXPO_EXPERIMENT.md).
For Expo development, `bun dev` now owns the Bun server, Metro development
client, configured emulator/simulator builds, categorized logs, and both native
Fast Refresh and framework-aware AbsoluteJS HMR from the application root.

`keyboard` provides portable visibility, CSS-pixel height, dismissal, and
cleanup-safe change events. `systemBars` controls modern edge-to-edge status and
navigation bar foreground appearance/visibility through Capacitor 8 core. Its
`light` and `dark` values name the icon/text foreground. Web appearance uses
best-effort `color-scheme`; browser chrome visibility reports unsupported.

Camera capture requires an explicit `camera.requestPermission()` call from an
intentional user action. `photos.pick()` uses the item-scoped system picker
without requesting broad library access. AbsoluteJS generates the required iOS
usage descriptions from the same audited capability metadata; this first slice
does not expose EXIF metadata or save captures into the gallery, and Android does
not receive unnecessary camera/storage permissions.

Clipboard and Share use browser standards on the web and fail with normalized
errors when unavailable. Haptics uses vibration where supported and otherwise
safely becomes a no-op, because tactile feedback must never be required to
complete an action.

### Self-hosted fonts

List your fonts in `absolute.config.ts` and the build downloads them from
Google Fonts (or copies local files), serves them from your own origin with
hashed names, preloads the critical faces and adds a metric-matched fallback
so text doesn't shift while the font loads:

```ts
export default defineConfig({
	fonts: { families: [{ family: 'Poppins', weights: [400, 700] }] }
});
```

Pass `fontAssets(manifest)` as the `fonts` option of `Head` or
`generateHeadElement`; HTML and HTMX pages get the tags automatically. Each
family gets a `--font-poppins` variable and a `.font-poppins` class. See
[docs/FONTS.md](docs/FONTS.md).

### Immutable production images

Build production assets and the server bundle while constructing the image,
then launch that prepared output without writing to it at runtime:

```bash
absolute prepare src/server.ts --outdir build
absolute start src/server.ts --outdir build --prebuilt
```

If image optimization is enabled in a read-only container, configure its
runtime cache on a bounded writable filesystem such as a `tmpfs`:

```ts
export default defineConfig({
	buildDirectory: 'build',
	images: { cacheDirectory: '/tmp/absolutejs-image-cache' }
});
```

---

## Plugin System

Absolute JS piggybacks on the [Elysia plugin API](https://elysiajs.com/plugins). Any Elysia plugin works out of the box; Absolute adds helpers for:

| Plugin                 | Description                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| **`@absolutejs/auth`** | Full OAuth2 flow configured with 81 providers and allows full customizability with event handlers |
| **`networking`**       | Starts your Elysia server with HOST/PORT defaults from environment variables                      |

### Elysia composition contract

This contract is written for application authors and coding agents. It avoids
the runaway TypeScript instantiation cost that can occur when one inferred
Elysia application is repeatedly extended and re-aliased.

- Start every independently owned route surface from a named `new Elysia(...)`.
- Give each surface its shared context and plugins explicitly. Do not create
  `adminApp` by extending `publicApp`, for example.
- Prefer one shallow `.use([auth, metrics])` over a long sequence of `.use()`
  calls. `absolute/elysia-composition-boundaries` enforces this and safely
  auto-fixes comment-free chains.
- Mount independent route surfaces at the platform root. Export each real
  sub-application type for Eden consumers instead of exporting an accumulated
  server alias.
- Keep `elysia` and `@sinclair/typebox` on one physical installed identity
  across the workspace. Run `absolute doctor`; `absolute doctor --fix` aligns
  root overrides and rebuilds Bun's dependency graph when peer contexts drift.

After a dependency change, measure a cold typecheck once. Warm incremental
checks can hide an unhealthy graph:

```bash
/usr/bin/time -v bun run tsc --noEmit --incremental false
```

---

## Configuration Philosophy

Everything funnels through a single `build()` call:

```ts
await build({
	reactDirectory: 'src/react',
	svelteDirectory: 'src/svelte',
	htmlDirectory: 'src/html',
	htmxDirectory: 'src/htmx',
	assetsDirectory: 'public/assets'
});
```

No separate config files or environment variables—just explicit arguments with sensible defaults.

## Workspace Dev Logs

`absolute workspace dev` keeps the TUI focused on service status and live service output. Full logs are also written to `.absolutejs/workspace/logs/`, including `all.log` and one file per service, so long output can be copied or searched outside the TUI:

```bash
tail -n 200 .absolutejs/workspace/logs/all.log
```

---

## Roadmap

- Prisma support beyond connection discovery (`absolute db` already finds a
  `schema.prisma` to read the connection from)
- Biome support
- First-class Docker images and hosting recipes
- A published docs site; `docs/` in this repository is the current source

Angular handlers and the hot-reload development server were on this list and
have shipped: `absolute dev` rebuilds and hot-updates every framework, and
Angular has page handlers, file routes, nested layouts and islands like the
rest.

---

## Contributing

Pull requests and issues are welcome! Whether it’s a new plugin, framework handler, or docs improvement:

1. Fork & branch.
2. `bun install && bun test`.
3. Submit a PR with a clear description.

---

## License

**Business Source License 1.1 (BSL-1.1)** – see [`LICENSE`](./LICENSE) for details.

## Background work during prerendering

Builds can start a temporary application server to render pages. This process
inherits application configuration and is stopped once rendering finishes; it
must not start billing, queues, scheduled emails, or other durable workers.
Absolute sets `ABSOLUTE_PRERENDER=1` on this child, overriding inherited values.
Use the runtime helper before starting background work:

```ts
import { isPrerendering } from '@absolutejs/absolute';

if (!isPrerendering()) {
	startBackgroundWorkers();
}
```

This is a lifecycle signal, not a sandbox: unguarded application side effects
can still run. Do not set this flag in the deployed server's environment.

### Compiled browser asset retention

Compiled servers archive namespaced browser asset graphs so tabs opened before a
deployment can still load lazy routes. Graphs are retained for up to seven days
after retirement, including across rapid deployments; there is no release-count
cap. The default shared storage budget is 512 MiB. Set
`ABSOLUTE_ASSET_ARCHIVE_MAX_BYTES` to a positive integer byte count to size the
budget for your deployment frequency and browser bundle size. If the byte budget
is exhausted, the oldest retired graphs are evicted and a warning identifies
each unexpired graph removed. Current embedded assets remain available.

Set `ABSOLUTE_ASSET_ARCHIVE_DIR` to a persistent writable directory shared by
deployment slots. Without it, the archive defaults to `.absolutejs/client-assets`
relative to the runtime working directory. Keep the archive outside ephemeral
release directories. Tabs older than the retained window still need an explicit
update/reload recovery flow; never silently reload unsaved user input.

Run `absolute migrate --target elysia-2` to locate legacy Elysia calls in a
project. Use `--path <directory>` to select the project and `--json` for file,
line and message data. `--check` exits with status 1 when findings remain.
`--apply` updates locally traced Elysia scope literals and reports remaining
calls for signature review. Run the project typecheck after applying changes.

# React Server Components and Server Actions — plan

Status: Phase 1 implemented (2026-11-12). Phases 2–6 are the plan.

## Goal

Opt-in React Server Components (RSC) for React pages served from ordinary
Elysia routes, plus Server Actions, without changing classic React pages or
any other framework. Classic `handleReactPageRequest` pages keep their
current pipeline byte for byte.

## Where the React pipeline is today (verified against the code)

- **Server render.** `handleReactPageRequest` (src/react/pageHandler.ts)
  `createElement(Page, props)` → `react-dom/server.renderToReadableStream`
  with `bootstrapModules: [index]`, a `bootstrapScriptContent` carrying
  `window.__INITIAL_PROPS__` (+ the dev `$RefreshReg$` buffer), and
  `nonce: readCspNonce()`. The stream goes through
  `injectIslandPageContextStream`, optional `withRegisteredStreamingSlots`
  (`collectStreamingSlots`), and `withPageCacheHeaders`.
- **Hydration indexes.** `generateReactIndexFiles`
  (src/build/generateReactIndexes.ts) writes one index per page in
  `<reactDirectory>/pages` that imports the page and calls `hydrateRoot`
  with `__INITIAL_PROPS__` (`createRoot` on HMR remounts).
- **Bundling.** build() (src/core/build.ts) runs parallel Bun.build passes:
  server (`target: 'bun'`), React client (`target: 'browser'`, `splitting`,
  React externalised to `/react/vendor/*` built by `buildReactVendor`,
  `reactFastRefresh` + dev JSX when HMR is on), non-React client, islands,
  and CSS. `generateManifest` turns outputs into PascalCase keys
  (`<Page>Index`, …); server pages (Svelte/Vue/Angular) are rewritten to
  absolute disk paths.
- **Dev.** `prepareDev` patches `<Page>Index` manifest entries to
  `/@src/…` URLs served by the unbundled module server
  (src/dev/moduleServer.ts); Fast Refresh runs through the patched-Bun
  transpiler (`reactFastRefresh`). Client assets are served from an
  in-memory asset store (`populateAssetStore`) filled from manifest web
  paths plus every `chunk-*` file; `cleanStaleAssets` deletes hashed files
  the manifest no longer names.
- **Production static root.** The build directory is the static root;
  `productionStaticIgnorePatterns` hides `/(react|svelte|…)/server/**`,
  `.map` files and runtime JSON.
- **Nothing RSC-related existed.** No `"use client"`/`"use server"`
  handling, no `react-server` condition anywhere, and no
  `react-server-dom-*` package in node_modules or the Bun cache.

## Key decisions

1. **Flight implementation: `react-server-dom-webpack`, installed by the
   app, not vendored by the framework.** Checked options:
   - `react-server-dom-esm` is a 0.0.1 placeholder on npm.
   - `react-server-dom-parcel`/`-turbopack` are tied to those bundlers'
     runtimes.
   - `react-server-dom-webpack` only needs three globals
     (`__webpack_require__`, `__webpack_chunk_load__`, and in dev
     `__webpack_get_script_filename__`), which generated entries provide on
     top of Bun.build. Its `server.edge`/`client.edge`/`client.browser`
     builds have no webpack runtime dependency (its `dependencies` only serve
     `plugin.js`/`node-register`).

   The Flight server and client reach into React internals, so the package
   must match the app's `react` version. Vendoring one copy into
   `@absolutejs/absolute` would pin every app to it, so it is a peer the app
   installs (`bun add react-server-dom-webpack@<react version>`); the build
   resolves it from the project and fails with that instruction when it is
   missing. **Security:** 19.0.0–19.2.0 have the Flight RCE
   (CVE-2025-55182) and 19.2.1–19.2.2 the follow-up DoS/source-exposure
   fixes; require ≥ 19.2.3 (or the patched 19.0.x/19.1.x lines). Phase 2
   adds a build-time version check (`react-server-dom-webpack` version ===
   `react` version and not in a vulnerable range).
2. **Separate opt-in directory, separate pass.** `reactServerComponentsDirectory`
   (pages directly in `<dir>/pages`). Keeping RSC pages out of
   `reactDirectory` means `generateReactIndexFiles`, the React vendor
   build, Fast Refresh and the module server never see them, so classic
   pages are unchanged. `"use client"` components may import anything,
   including components under `reactDirectory`.
3. **Three Bun.build passes, sequential after the existing parallel
   passes** (src/build/buildReactServerComponents.ts):
   - **react-server** (`target: 'bun'`, `conditions: ['react-server']`,
     splitting): one entry per page. A plugin replaces each `"use client"`
     module with `registerClientReference` proxies (export names from
     `Bun.Transpiler.scan`) and fills a virtual client manifest module. React,
     `react-server-dom-webpack/server.edge` and server components are
     bundled, so the server copy of React never meets the app's runtime copy.
   - **ssr** (`target: 'bun'`): every discovered client module +
     `client.edge` + `react-dom/server`, exporting `renderHtml(flight, opts)`.
     Rendering Flight → HTML inside this bundle keeps client components,
     hooks and react-dom on one React instance regardless of how the app's
     server.ts was bundled.
   - **client** (`target: 'browser'`, splitting): one hydration entry for all
     RSC pages; each client module is a lazy `import()` chunk keyed by module
     id, so a page only downloads the client components its payload names.

   Sequential because passes 2–3 need the client modules pass 1 discovers;
   the cost is only paid when the directory is configured.
4. **Module ids** are a 16-hex sha256 of the project-relative path: stable
   across builds, no file-system layout in the page.
5. **Manifest/asset() model.** `asset(manifest, '<Page>RSC')` → absolute
   path of the page's react-server bundle (server-only, under
   `react/server/rsc/`). A page file whose name already ends in `RSC` is not
   suffixed twice (`pages/HomeRSC.tsx` → `HomeRSC`); its old doubled key
   (`HomeRSCRSC`) stays as a deprecated alias that warns in dev, and when
   `pages/Home.tsx` also exists, `Home.tsx` keeps `HomeRSC`. Shared keys: `ReactServerClient` (web path of the
   hydration entry, so the dev asset store loads it) and
   `ReactServerRenderer` (disk path of the SSR bundle, listed so dev cleanup
   keeps it). A `react-server-runtime.json` next to the page bundles ties a
   page to the renderer/client of the same build. All outputs are content
   hashed and passed to `cleanStaleOutputs`.
6. **Payload inlining.** The Flight stream is tee'd: one branch feeds
   `renderHtml`, the other becomes
   `<script nonce>(self.__absoluteReactServerPayload??=[]).push("…")</script>`
   tags written after each HTML chunk once `<body>` has opened, the rest
   before `</body>` (src/react/serverComponents/flightPayload.ts). Chunks are
   JSON-escaped with `<`, U+2028/2029 also escaped. The hydration entry
   drains the array into a `ReadableStream`, closes it at
   `DOMContentLoaded`, and `hydrateRoot(document, <Root/>)` where
   `Root = () => use(createFromReadableStream(stream))`. No
   `__INITIAL_PROPS__`: page props go to the server component only.
7. **Streaming.** Async server components + `<Suspense>` stream natively
   (Flight rows and React's `$RC` segments interleave with payload
   scripts). The handler keeps the same response wrappers as classic pages
   (`runWithStreamingSlotWarningScope`, `withRegisteredStreamingSlots` when
   `collectStreamingSlots: true`, `withPageCacheHeaders`, ETag buffering).
   `StreamSlot`/`SuspenseSlot` *inside* the RSC tree are Phase 3 (see
   Interop).

## API

```ts
// absolute.config.ts
export default defineConfig({ reactServerComponentsDirectory: './src/rsc' });

// src/rsc/pages/Dashboard.tsx — a server component (async allowed)
export const Dashboard = async ({ userId }: { userId: string }) => { … };

// src/rsc/components/Counter.tsx
'use client';
export const Counter = () => { const [n, set] = useState(0); … };

// server.ts
import { handleReactServerPageRequest } from '@absolutejs/absolute/react';
app.get('/dashboard', () =>
  handleReactServerPageRequest({
    page: asset(manifest, 'DashboardRSC'),
    props: { userId: '42' }
  }));
```

The page component is the export named after the file (the React-page
convention) or the default export.

## Routing

- **Per route:** an RSC page is chosen by calling
  `handleReactServerPageRequest` in an ordinary Elysia handler, exactly like
  the other `handle*PageRequest` functions. Nothing changes for routes that
  use `handleReactPageRequest`.
- **Client navigation (Phase 3):** the same handler answers
  `Accept: text/x-component` (or `?__rsc=1` for caches that ignore `Vary`)
  with the raw Flight stream, `Vary: Accept`. The client router
  (`@absolutejs/absolute/react/router` Link interop) fetches the payload,
  `createFromFetch`, and `startTransition`s the root. No separate endpoint
  per page; the URL stays the page URL so auth/cookies/guards on the route
  apply unchanged. Cross-framework navigation (another agent's feature) hands
  off by full document navigation unless both sides are RSC.

## Server Actions (Phase 2)

- **Compile.** The react-server plugin also handles `"use server"` files
  and inline `"use server"` functions: exports are wrapped with
  `registerServerReference(fn, id, name)`; in the ssr/client passes the same
  module becomes `createServerReference(id, callServer)` stubs. Inline
  closures are hoisted by a Bun.Transpiler-based transform to module scope
  with bound arguments (Phase 2b; Phase 2a supports file-level
  `"use server"` only).
- **Ids.** `HMAC-SHA256(buildSecret, moduleId + '#' + export)`, truncated
  to 128 bits; the build writes `server-actions.json` (id → bundle + export)
  under `react/server/` (never served). Unknown ids → 404, no fallback
  lookup, so ids cannot be enumerated or guessed into arbitrary exports.
- **Endpoint.** One Elysia route mounted by `prepare()` when the directory
  is set: `POST /__absolute/action` (configurable). It loads the action from
  the manifest, `decodeReply`/`decodeAction` with the server manifest, runs it
  inside the existing request context (`getCurrentAbsoluteRequest`, cookies,
  `@absolutejs/auth` `protectRoute`-style guards available through Elysia
  context), and returns a Flight stream of the result plus a re-rendered
  tree when the action revalidates.
- **Progressive enhancement.** `<form action={serverFn}>` renders a real
  `<form method="post">` with the `$ACTION_ID_*` hidden field
  (`decodeAction`/`decodeFormState`); without JS the POST hits the page URL
  and the handler runs the action, then renders the page with
  `formState` for `useActionState`.
- **Typed results.** Actions are plain async functions, so client code
  imports them with their TS types; a typecheck fixture proves
  `Awaited<ReturnType<typeof action>>` flows to `useActionState`.
- **CSRF.** Same-origin check on `Origin` (fallback `Sec-Fetch-Site`) for
  every action POST, plus `Content-Type` allowlist
  (`text/plain`/`multipart/form-data` from React); cross-origin → 403.
  Works with `secureHeaders()`' `form-action 'self'`.
- **Closures/arguments.** Bound closure values are encrypted
  (AES-GCM, per-build key derived from `ABSOLUTE_ACTION_SECRET` or a
  generated secret persisted in the build dir) before they reach the
  client; if no secret is configured in production, actions with bound
  closures fail the build instead of shipping plaintext. Arguments are
  validated: actions may export a TypeBox/Standard-Schema `schema` that the
  endpoint checks before calling; `decodeReply` limits (max body size,
  max rows) guard the DoS class fixed in 19.2.3.

## Interop

- **Islands.** Other frameworks' islands inside an RSC page: the
  `<Island>` server component already renders markup + markers; the RSC
  handler gets `injectIslandPageContextStream` and the islands bootstrap
  like classic pages (Phase 4). A React island inside an RSC page is just a
  `"use client"` component.
- **StreamSlot/SuspenseSlot.** Today they register in the framework's
  module-level registry, which the self-contained SSR bundle would
  duplicate. Phase 3 marks `@absolutejs/absolute/*` external in the ssr
  pass (resolved at runtime from the project) and makes those components
  React-instance-agnostic, then reuses `collectStreamingSlots`.
- **Eden.** Client components call Eden treaty clients as usual (they are
  browser code). Server components call the Elysia app in-process through
  `treaty(app)` — no HTTP hop; documented, not new code.
- **HMR (Phase 3).** Phase 1 already routes an edit under the RSC
  directory (`queueFileChange` → src/dev/reactServerComponentsRebuild.ts)
  to a rebuild of just the RSC pass and swaps the manifest entries, so the
  next request renders the edit; open pages are not pushed (no HMR client
  on RSC pages yet), and a `"use client"` file *outside* the directory still
  takes the classic React path and needs a restart. Planned: inject the HMR
  client from the hydration entry; for a server-component edit it
  refetches the Flight payload and swaps the root in a transition;
  for a `"use client"` edit the client pass is rebuilt with
  `reactFastRefresh` + dev JSX and the module swaps through the existing
  Fast Refresh runtime (`$RefreshReg$` buffer in `bootstrapScriptContent`).
- **Typecheck.** No new types for users beyond the handler input; async
  components need `@types/react` ≥ 19. `absolute typecheck` already covers
  the directory if it is in the app's tsconfig.
- **Prerender/ISR (Phase 5).** The handler's response is plain HTML, so
  `prerender` works once the route is listed; the Flight payload is inside
  the HTML. ISR keeps the payload alongside (`<route>.rsc`) for client
  navigation.
- **absolute compile (Phase 5).** Server bundles are imported by absolute
  path from the manifest like Svelte/Vue SSR bundles; `compile` must embed
  `react/server/{rsc,ssr}` and the runtime JSON. Not verified yet.

## Security summary

- Server component code, data and the react-server bundles never reach the
  browser: bundles live under `react/server/` (hidden by
  `productionStaticIgnorePatterns`; the Phase 1 test asserts a 404), the
  client bundle contains only client modules (test asserts server code is
  absent).
- Every inline script the handler emits carries the CSP nonce
  (`nonceAttr(readCspNonce())`); React gets `nonce` for its own scripts.
  The Phase 1 test runs under `secureHeaders()` and checks every inline
  script tag.
- Dev Flight payloads include React's dev debug info (component names,
  server stack frames); production payloads do not.
- Action ids, CSRF, closure encryption, argument validation: Phase 2 above.
- Known Flight CVEs: version floor in decision 1.

## Phases and exit criteria

1. **Phase 1 — RSC pages (done).** Async server components, `"use client"`
   components, Suspense streaming, inline payload, hydration, CSP nonce, dev
   (`absolute dev`) and production (`absolute build` / `start`).
   *Exit:* tests/integration/server/react-server-components.test.ts green in
   dev and production (Playwright click on the client counter), unit tests
   for payload escaping/injection, packed-tarball e2e in a scaffolded app.
2. **Phase 2 — Server Actions + package hygiene.** File-level
   `"use server"`, action endpoint, progressive-enhancement forms,
   `useActionState`, CSRF, HMAC ids; version check; add
   `react-server-dom-webpack` as optional peer + devDependency (needs a
   lockfile update in the main checkout).
   *Exit:* Playwright: action mutates server state and re-renders with and
   without JS; forged/unknown id → 404; cross-origin POST → 403.
3. **Phase 3 — Navigation + HMR + slots.** `Accept: text/x-component`
   payload responses, router integration, server/client component HMR,
   StreamSlot/SuspenseSlot inside RSC trees.
   *Exit:* HMR tests edit a server and a client component without a full
   reload and keep client state; navigation test swaps pages without a
   document load.
4. **Phase 4 — Islands + inline closures.** Cross-framework islands in RSC
   pages, inline `"use server"` closures with encrypted bound args.
5. **Phase 5 — Prerender/ISR, compile, CSS.** CSS imported by client and
   server components linked in `<head>` (today: not collected), prerender,
   `absolute compile`, external server packages (today the react-server
   pass bundles all dependencies, which breaks native addons).
6. **Phase 6 — Docs + scaffold.** create-absolutejs option, README section.

## Phase 1 limitations (known)

- CSS imported from server or client components is not linked.
- Binary Flight rows (typed arrays as props) are decoded as UTF-8 text.
- `export *` in a `"use client"` module is not expanded (only direct
  exports become references).
- The react-server pass bundles every dependency; packages with native
  addons need Phase 5's externals.
- No client navigation, no push HMR (edits show on reload), no actions.

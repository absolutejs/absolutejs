# Serverless and edge targets: evaluation and plan

Status: evaluated 2026-11-12 against 0.20.0-beta.170 (Elysia 2.0.0-rc.1,
Bun 1.4.4). Implemented: the scale-to-zero container path
(`templates/container/`), one framework fix it needed, and tests. Nothing
else here is built.

Statements marked **(unverified)** come from memory of platform
documentation and were not checked in this evaluation. Everything else was
read in the source or measured on this machine.

## Conclusion first

| Target | Verdict | Effort |
| --- | --- | --- |
| Bun in a container on a scale-to-zero platform (Cloud Run, Fly Machines, Railway, Render, Knative, Fargate) | **Supported now.** Dockerfile in `templates/container/`, measured, tested | Done (this change) |
| AWS Lambda, container image + AWS Lambda Web Adapter | Likely works with the same image and no framework change **(unverified: not deployed)** | 1-2 days to verify and document |
| AWS Lambda, zip + Bun custom runtime layer | Not worth it: needs a Lambda event to `Request` handler and a build that fits the zip limit | 1-2 weeks |
| Cloudflare Workers, Vercel Edge | **Not supported.** Needs a second, Fetch-API-only server build and runtime | 2-3 months, and a different framework at the end |
| Deno Deploy | **Not supported.** Same blockers as Workers, minus a few | 1-2 months |

The production runtime is built on the filesystem and on Bun: page
handlers `import()` page bundles by path at request time, static files and
pre-rendered pages are served from disk, and some fallbacks compile sources
with `Bun.build` and `Bun.Transpiler` while serving. None of that exists on
an edge isolate. The roadmap's position (ROADMAP.md section 17, "Edge
runtime is unlikely to be worth pursuing") holds. What users want from
"serverless" is usually pay-per-use and scale to zero, and a container
gets that today with a 160-550 ms cold start.

## 1. What the production runtime uses

Production entry points read: `src/cli/scripts/start.ts` (`absolute start`,
`start --prebuilt`, `prepare`), `src/cli/scripts/compile.ts` (the
generated executable entry, `generateEntrypoint`), `src/core/prepare.ts`
(production branch of `runPrepare`), `src/core/productionRuntime.ts`, and
everything the server bundle reaches from them.

Counts of Bun APIs in the server bundle of a scaffolded app
(`dist/server.js`, `grep -o 'Bun\.[a-zA-Z]*'`): `Bun.file` 62, `Bun.write` 25,
`Bun.resolveSync` 25, `Bun.Transpiler` 21, `Bun.hash` 17, `Bun.sleep` 8,
`Bun.main` 6, `Bun.build` 6, `Bun.CryptoHasher` 4, `Bun.Glob` 3,
`Bun.spawnSync` 3, `Bun.version` 3, `Bun.Image` 2, `Bun.escapeHTML` 2,
`Bun.serve` 1, `Bun.spawn` 1, `Bun.env` 1, `HTMLRewriter` 6 references, and
imports from `fs` (104), `fs/promises` (49), `path` (144), `async_hooks`
(10), `typescript` (19). Not every one is on the request path; the table
classifies the ones that are, or that run at boot.

Classes: **portable** runs on any WinterCG runtime with Node compatibility;
**adaptable** has a known replacement that needs work; **blocking** has no
replacement without redesigning the feature.

| Use | Where | Container | Lambda (Bun) | Workers / Vercel Edge | Deno Deploy |
| --- | --- | --- | --- | --- | --- |
| `Bun.serve` via Elysia `.listen()` and the networking plugin; compiled executable builds its own `Bun.serve` | `src/plugins/networking.ts`, `compile.ts` | portable | adaptable (Web Adapter or an event handler around `app.handle`) | adaptable: Elysia 2 has `WebStandardAdapter` and Cloudflare detection (`elysia/universal/constants`); the app exports `fetch` instead of listening | adaptable (`Deno.serve(app.fetch)`) |
| Page bundles loaded with `await import(path)` from the manifest at request time (Svelte, Vue, Angular pages; React components are bundled in) | `src/svelte/pageHandler.ts`, `src/vue/pageHandler.ts`, `src/angular/pageHandler.ts` | portable | portable | **blocking**: isolates allow no runtime import of files; every page would have to be statically bundled into one worker | **blocking** for the same reason **(unverified for Deno Deploy's dynamic import support)** |
| Static assets from the build directory (`@elysia/static` walks `dist/` with `node:fs`; generated hydration bundles via `Bun.file`; precompressed `.br`/`.gz` siblings) | `src/core/prepare.ts`, `src/core/precompressed.ts` | portable | portable (read-only `/var/task`) | adaptable: move to the platform's asset store (Workers Static Assets, Vercel's CDN) and drop the route | adaptable (static files in the deployment) |
| Manifest, conventions, SPA routes, `absolute-runtime.json` read with `readFileSync` at boot | `src/core/prepare.ts`, `productionRuntime.ts` | portable | portable | adaptable (inline as JSON at build) | portable |
| Pre-rendered pages: `_prerendered/*.html`, `.meta` timestamp and `.nonce` sidecars, ISR by re-fetching `http://localhost:$PORT` and `Bun.write` over the file | `src/core/prerender.ts`, `src/core/prerenderNonce.ts` | portable; ISR needs a writable build (see below) | serving portable; ISR re-render blocking (read-only, and no loopback server under a plain handler) | serving adaptable (assets); ISR blocking (no filesystem, no loopback) | same as Workers |
| CSP nonce rewriting of static and pre-rendered HTML with `HTMLRewriter` | `src/core/staticHtmlNonce.ts`, `src/core/prerenderNonce.ts` | portable | portable | portable (Workers has `HTMLRewriter`) **(unverified for Vercel Edge)** | adaptable (no `HTMLRewriter`; a WASM port exists **(unverified)**) |
| Request context, streaming slots, island registration through `AsyncLocalStorage` | `src/core/requestContext.ts`, `streamingSlotRegistry.ts`, `src/utils/registerClientScript.ts` | portable | portable | portable with `nodejs_compat` **(unverified)** | portable |
| Image optimizer: `Bun.Image` resize/encode, cache in `<build>/.cache/images` (`.data`/`.meta`), optional `sharp` from `cwd/node_modules` for AVIF | `src/plugins/imageOptimizer.ts`, `src/utils/imageProcessing.ts` | portable (verified on linux/arm64: WebP served) | portable; cache needs `images.cacheDirectory` under `/tmp` | **blocking** (no `Bun.Image`, no native `sharp`); use the platform's image service | blocking for the same reason |
| Runtime compile fallbacks: Svelte/Vue island and string-source pages compiled with the compiler + `Bun.Transpiler`, Angular islands with `Bun.build`, written to `cwd/.absolutejs/islands/*` | `src/core/svelteServerModule.ts`, `vueServerModule.ts`, `angularServerModule.ts`, `src/core/renderIslandMarkup.ts` | portable if `cwd` is writable; otherwise those islands fail | adaptable (point the cache at `/tmp`) | **blocking** (no `Bun.build`, no `eval` of generated code in Workers **(unverified for Vercel Edge)**) | blocking |
| `Bun.file` responses, `Bun.write`, `Bun.hash`, `Bun.CryptoHasher`, `Bun.escapeHTML`, `Bun.resolveSync` across page handlers and utilities | many | portable | portable | adaptable one by one (`fetch` of assets, `crypto.subtle`, a JS escape, build-time resolution) | adaptable |
| WebSockets: Elysia `.ws()` through `Bun.serve`'s `websocket`, HMR socket stubbed out of production | `networking.ts`, `compile.ts` | portable while the instance lives | **blocking** behind Lambda (no WebSocket over Function URLs or the Web Adapter; API Gateway WebSockets is a different model **(unverified)**) | adaptable (Durable Objects on Workers **(unverified)**; none on Vercel Edge **(unverified)**) | portable (`Deno.upgradeWebSocket`) |
| Instance registry: `~/.absolutejs/instances/<pid>.json` | `src/utils/instanceRegistry.ts` (networking self-register, `start` controller) | skipped with `ABSOLUTE_INSTANCE_MANAGED=1` (the template sets it); the compiled executable writes it best-effort | same | n/a | n/a |
| `killStaleProcesses` runs `lsof` before `start` | `src/cli/utils.ts` | harmless (no `lsof` in the slim image; the error is caught) | n/a | n/a | n/a |
| Compiled executable unpacks its SSR runtime into `TMPDIR` on the first non-prerendered request (about 80 MB) and keeps a client-asset record in `cwd/.absolutejs/client-assets` (or `ABSOLUTE_ASSET_ARCHIVE_DIR`) | `compile.ts`, `src/runtime/clientAssetArchive.ts` | portable (the template points the record at `/tmp`) | adaptable (512 MB `/tmp` default **(unverified)**) | n/a | n/a |
| HMR, dev server, file watchers, `Bun.build` of the app | stubbed out of the production bundle by `stubPlugin` in `start.ts` | none at run time | none | none | none |
| Bun SQL, `bun:sqlite`, workers | only in the CLI (`src/cli/scripts/dbEngines/*`, build `workerPool`); none in the production runtime | n/a | n/a | n/a | n/a |
| Externals resolved from `node_modules` at run time: react, react-dom, vue, svelte, Angular, `typescript`, plus anything `bunBuild.external` names | `src/cli/serverBundleExternals.ts` | portable (ship production `node_modules`) | adaptable (they push a zip past its limit; see sizes) | blocking as-is (everything must be bundled into the worker) | adaptable (npm specifiers) |
| Platform-specific native addons inside the server bundle: a macOS build carries `tailwindcss-oxide.darwin-arm64-*.node` next to `server.js` | the server bundle pulls in Tailwind's oxide loader | portable if built inside the target OS; the template builds in Linux | same | blocking | blocking |

Two of these were found by running a scaffolded app in a container, not by
reading:

1. **Fixed in this change.** The image optimizer created
   `<build>/.cache/images` when the server booted, so a server that could
   not write its build directory crashed with `EACCES` before answering:
   the default container layout (build copied as root, server runs as a
   non-root user) and any read-only root filesystem. The directory is now
   created on the first cache write; a cache that cannot be written is
   skipped.
2. **Documented.** `HOST` defaults to `localhost`, and a server bound to
   `localhost` (on macOS it bound `[::1]` only) is unreachable from outside
   a container. The template sets `HOST=0.0.0.0`. The compiled executable
   binds all interfaces already.

Also seen: `absolute prepare`/`start` write to `dist/` regardless of the
config's `buildDirectory` unless `--outdir` is given, and the startup
banner shows an empty version (`v`) when the bundle runs without the CLI.
Neither blocks anything.

## 2. Targets

### Bun in a container that scales to zero

What works: everything the long-lived server does, because it is the
long-lived server. The cost is the cold start.

What changes compared with a long-lived server:

- **Filesystem.** The image is the deploy; the container's disk is
  ephemeral or read-only. The prepared build serves from a read-only
  `dist/` with no framework writes (verified: `find / -newer` in the
  container after a boot and requests shows only Docker's own files). The
  image optimizer's cache needs `images.cacheDirectory` pointed somewhere
  writable to be useful; it is per-instance and lost on scale-in.
- **ISR.** `static.revalidate` rewrites `_prerendered/*.html` in place,
  which a read-only build cannot do (the re-render fails silently and the
  stale page keeps being served). Across instances there is no shared store
  either. On scale-to-zero, regenerate by deploying.
- **WebSockets.** Work while an instance is up. Platforms cap request
  duration (Cloud Run 60 min max **(unverified)**) and drop sockets when they
  scale in.
- **Streaming.** Works; Cloud Run and Fly stream HTTP/1.1 chunked responses
  **(unverified)**.
- **Memory.** 90 MiB for the prepared server after one request per page,
  156 MiB for the compiled executable with its runtime unpacked on tmpfs.
  On Cloud Run the filesystem is memory-backed **(unverified)**, so the
  executable's 80 MB unpack counts against the instance's memory.

Elysia: native target (Bun adapter).

### AWS Lambda with a Bun runtime

Two shapes:

- **Container image + AWS Lambda Web Adapter.** The adapter runs the
  container's HTTP server and translates Lambda events to HTTP. The same
  image as above should work with the adapter copied in and `PORT` set
  **(unverified: not deployed)**. Lambda's filesystem is read-only except
  `/tmp`, which is exactly the setup the read-only test covers. No
  WebSockets. Response streaming needs the adapter's streaming mode
  **(unverified)**. Container images up to 10 GB **(unverified)**.
- **Zip + Bun custom runtime layer (`bun-lambda`).** Needs a handler that
  turns Lambda events into `Request` and calls `app.handle()` (Elysia
  supports `handle` with no listener), plus a build that fits the zip
  limit: 250 MB unzipped across function and layers **(unverified)**. The
  prepared server's production `node_modules` alone is 237 MB, plus 25 MB of
  `dist/`, so the zip shape needs a fully bundled server (no externals),
  which `start.ts` deliberately does not produce (Svelte and Angular must
  stay single-instance). Not worth it while the container shape exists.

Elysia: no Lambda adapter; `app.handle(request)` is enough for a handler.

### Cloudflare Workers and Vercel Edge

No Bun. Workers run V8 isolates with optional Node compatibility; Vercel
Edge is similar. What breaks:

- Every `Bun.*` call on the request path (table above), notably `Bun.file`
  responses, `Bun.Image`, `Bun.build`/`Bun.Transpiler` in the compile
  fallbacks.
- Page handlers that `import()` page bundles by filesystem path. The whole
  model of a manifest of file paths that the server imports on demand has
  to become a statically bundled module map.
- Static assets and pre-rendered pages from disk, ISR, the image cache,
  the island compile cache: all filesystem.
- WebSockets (Durable Objects on Workers would be a separate design).
- Size: the scaffolded server bundle is 6.0 MB before its externals
  (react-dom, vue, svelte), with an 11 MB source map. Workers' limits are
  3 MB (free) / 10 MB (paid) compressed **(unverified)**, Vercel Edge about
  1-4 MB **(unverified)**. A bundle with every framework's SSR in it would
  be at or over the limit before app code.

Elysia itself is closer: 2.0 has `WebStandardAdapter`, detects Cloudflare
Workers and Fastly, and ships an AOT plugin for runtimes that forbid
`new Function` **(the AOT plugin's Workers support is unverified)**. The
framework layer is the blocker, not Elysia.

Making it work means a second production build: one Fetch-API module per
deploy with every page's SSR statically imported, assets moved to the
platform's store, nonce rewriting kept on `HTMLRewriter`, no image
optimizer, no ISR, no runtime compile fallbacks, and a per-framework audit
of SSR on workerd (React and Vue have edge builds; Svelte's server render
is plain JS; Angular SSR on workerd is not known to work **(unverified)**).
Estimate: 2-3 months for a subset (React, Vue, Svelte, HTML; no Angular,
no islands compile fallback, no images), then ongoing cost to keep two
runtimes equivalent. The latency gain over a container in the right region
is small for SSR that reads from a regional database anyway.

### Deno Deploy

Deno runs npm packages and most `node:` APIs, which helps with `fs`-free
code, but there is no `Bun` global, no writable filesystem, and dynamic
import of files written at run time is not allowed **(unverified)**. Same
blockers as Workers except `HTMLRewriter` (missing here) and WebSockets
(available). Estimate: 1-2 months with the same second-build design; most
of the Workers work carries over.

## 3. Measurements

Machine: Apple Silicon Mac, macOS 26 (Darwin 25.3), Bun 1.4.4
(`1.4.4+absolute.1` on the host, stock `oven/bun:1.4.4-slim` in
containers), Docker Desktop 29.2 (linux/arm64 VM).

App: `create-absolutejs` default directory, React + Svelte + Vue + HTML
(with scripts) + HTMX, ESLint + Prettier, no Tailwind, with this checkout
packed as `0.20.0-beta.170` and installed from the tarball.

Method: a script spawns the command fresh, polls `GET /` every 2 ms
(each attempt with a short timeout), and records the time from spawn to the
first complete `200` response; it then times the first request to each
route, sends `SIGTERM`, and waits for the port to free. Median of 7 runs
unless noted. `/` is a static HTML page; `/htmx/count` is a plain route
that no build pre-renders, so it is the first request that needs the SSR
runtime in the compiled executable.

### Process start to first byte

| How it starts | Host (macOS) | Linux container (process inside it) |
| --- | --- | --- |
| `bun dist/server.js` with the template's env | 172 ms | 314 ms |
| `absolute start --prebuilt` (controller + child) | 283 ms | 616 ms |
| `absolute compile` executable, fresh `TMPDIR` each run | 27 ms to `/`; first `/htmx/count` +309 ms | 34 ms; +1114 ms with `TMPDIR` on the overlay disk |
| same, `TMPDIR` on tmpfs | | 16 ms; first `/htmx/count` +221 ms |
| `bun dist/server.js` with a warm Bun transpiler cache | | 202 ms |

The first macOS run of a freshly built executable took 2.6 s (the OS
scanning a new binary); later runs did not.

First requests after the first byte, prepared server: `/react` 5 ms,
`/svelte` 12-14 ms, `/vue` 20-42 ms, `/htmx` 1 ms.

### Container start to first byte (`docker run -d` until the first `200`)

`--read-only --tmpfs /tmp`, median of 5:

- `server` target: **550 ms** (450-736); first `/htmx/count` 1 ms.
- `binary` target: **160 ms** (147-234); first `/htmx/count` 211 ms.

### Sizes

| | macOS build | Linux build |
| --- | --- | --- |
| `dist/` from `absolute prepare` | 24 MB (`server.js` 6.0 MB, `server.js.map` 11 MB) | 25 MB |
| Production `node_modules` (`bun install --production`) | | 237 MB (89 MB of it `@absolutejs/*`, 28 MB `drizzle-orm`, 23 MB `typescript`) |
| `absolute compile` executable | 158 MB | 177 MB (185,256,952 bytes) |
| Image (`docker image inspect .Size`) | | `server` 134 MB, `binary` 156 MB, base `oven/bun:1.4.4-slim` 85 MB |
| Memory after one request per route (`docker stats`) | | `server` 90 MiB, `binary` 156 MiB |

## 4. What was implemented

- `templates/container/Dockerfile`, `.dockerignore`, `README.md`: a
  multi-stage build that runs `absolute prepare` inside Linux, installs
  production dependencies separately, and produces either the prepared
  server (default target, `bun dist/server.js`, non-root, `HOST=0.0.0.0`,
  `ABSOLUTE_INSTANCE_MANAGED=1`) or the compiled executable
  (`--target binary`). Both verified with `docker build` and
  `docker run --read-only --tmpfs /tmp`: every route of the scaffolded app
  and `/_absolute/image` answered `200`; `docker stop` took 1.3 s (Bun
  handles `SIGTERM` as PID 1).
- `src/utils/imageProcessing.ts`: the image cache directory is created on
  the first write instead of at boot.
- `tests/unit/plugins/imageOptimizerReadOnly.test.ts`: the optimizer boots
  and serves over a read-only build, and a writable build gets its cache on
  the first image.
- `tests/integration/server/container-start.test.ts`: prepares the example
  app, makes the build read-only, starts `server.js` the way the Dockerfile
  does from an app root that holds only `node_modules`, with an empty
  `HOME` and its own `TMPDIR`; asserts the first response within 15 s, `200`
  from the React, Svelte, Vue and HTMX pages and the image endpoint, exit
  within 5 s of `SIGTERM`, and no change to the build, the app root or
  `HOME`.

## 5. Possible next steps, not done

- **Bake a warm transpiler cache into the image.** Bun caches transpiled
  large files (`BUN_RUNTIME_TRANSPILER_CACHE_PATH`); with a warm cache the
  prepared server's first byte dropped from 314 ms to 202 ms in the
  container. Warming it at image build time means running the server during
  `docker build`, which runs app code (database connections, secrets), so
  it is not in the template.
- **Unpack the compiled executable's runtime at boot, or lazily per page.**
  Today the first non-prerendered request pays 200-1100 ms for an 80 MB
  unpack.
- **Lambda Web Adapter recipe**, verified on AWS.
- **A `prepare` mode that skips `node_modules`** (bundle everything except
  the single-instance runtimes) to shrink the prepared image; 237 MB of
  `node_modules` is most of it.
- **Do not bundle native addons** that the server never calls (the Tailwind
  oxide loader) into `dist/`.

## Project Overview

AbsoluteJS is a full-stack, type-safe TypeScript meta-framework. It provides universal SSR for React, Svelte, Vue, Angular, HTML, and HTMX, plus a cross-framework islands runtime, all on Bun + Elysia. Distributed as `@absolutejs/absolute` with optional native helpers in `@absolutejs/native-*` (Zig).

## Commands

The framework ships its own CLI (`absolute <cmd>`); the package.json scripts wrap it.

```bash
bun run typecheck   # absolute typecheck (no emit)
bun run format      # absolute prettier --write
bun run lint        # absolute eslint
bun run dev         # absolute dev (ask before using)
bun run build       # build the package to dist/ (do not run)
bun test            # do not run
```

CLI commands in `src/cli/index.ts`: `dev`, `start`, `build`, `compile`, `typecheck`, `eslint`, `prettier`, `workspace`, `info`, `telemetry`, `mkcert`.

## Repository layout

- `src/core/` — orchestrator. `build.ts` is the central pipeline; also handles islands SSR, page handlers, prerender, prepare, response enhancers, streaming-slot wrapping.
- `src/build/` — compilers and build helpers: `compileSvelte`, `compileVue`, `compileAngular`, `compileTailwind`, vendor builders (`buildReactVendor`, `buildAngularVendor`, `buildSvelteVendor`, `buildVueVendor`, `buildDepVendor`), entry-point + convention scanners, manifest, asset-path updater, style preprocessor, HMR plugins, island entry generation.
- `src/dev/` — dev server and HMR pipeline: `moduleServer`, `transformCache`, `dependencyGraph`, `fileWatcher`, `webSocket`, `clientManager`, `rebuildTrigger`, `devCert`, plus a browser-side `client/` (DOM diff, head patch, error overlay, framework detection).
- `src/{react,svelte,vue,angular}/` — framework adapters: server `pageHandler`, client browser entry, components. Angular is the largest (compiler patches, vendor resolution, injector patch, HMR preservation, islands).
- `src/islands/` — cross-framework island runtime + browser entry.
- `src/plugins/` — Elysia plugins: `hmr`, `pageRouter`, `networking`, `imageOptimizer`, `devtoolsJson`.
- `src/cli/` — CLI dispatcher, scripts, telemetry, workspace TUI.
- `src/utils/` — config loader/`defineConfig`, image processing, sitemap, JSON-LD, head element, streaming slots, logger, path validation.
- `src/frontend/react/`, `src/client/` — shared client-side runtime bits.
- `types/` — all type definitions live here (per project convention).
- `native/` — Zig sources + per-platform packages.
- `example/` — example app used by `bun run dev` and `bun run start`.

`src/index.ts` re-exports `build/`, `core/`, `plugins/`, `utils/`, `constants`, and types. It also has a side-effect import of `./angular/injectorPatch` — load-bearing for code paths that import `dist/angular/*` directly.

## Build pipeline (`src/core/build.ts`)

`build(config)` acquires a build-directory lock and runs `buildUnlocked`. High-level flow:

1. **Path validation** via `validateSafePath` for every configured directory.
2. **Convention + entry-point scanning** (`scanConventions`, `scanEntryPoints`, `scanCssEntryPoints`) across react/svelte/vue/angular/html/htmx.
3. **React index generation** (`generateReactIndexFiles`) for hydration entries.
4. **Asset copy**, optional **Tailwind compilation**, optional **HTML image optimization**.
5. **Per-framework compilation** for Svelte/Vue/Angular (SSR + client variants); Angular also runs partial-declaration linking via `angularLinkerPlugin`.
6. **Vendor builds** for React, Svelte, Vue, Angular (server + client), and shared deps — externalized so HMR can swap modules without rebundling.
7. **Bun bundling — 4 parallel passes** (`Promise.all`): server (`target=bun`), React client (`target=browser`, optional `reactFastRefresh`), non-React client, islands client. Plus 2 CSS passes (global, Vue).
8. **Manifest generation** (`generateManifest`) maps PascalCased filenames → hashed asset paths.
9. **Asset path updating** (`updateAssetPaths`) injects hashed paths into HTML.
10. **Stale-output cleanup** + intermediate `compiled/` removal unless `preserveIntermediateFiles`.

Tracing is gated by `ABSOLUTE_BUILD_TRACE`; telemetry events are emitted at key points.

## Framework SSR + islands

All frameworks: server renders HTML → props serialized into `window.__INITIAL_PROPS__` → client hydrates via the framework's browser entry. Hydration indexes auto-generate during build.

Islands work cross-framework via `src/islands/` + `src/build/islandEntries.ts`. Static HTML pages can embed islands of any framework; each island ships its own client bundle.

## Dev / HMR

Dev mode runs an unbundled ESM module server (`src/dev/moduleServer.ts`) with per-file transpilation, mtime + ETag caching, and an importer-graph for chain invalidation. WebSocket-driven HMR client (`src/dev/client/`) handles framework-specific patching, head sync, error overlay. React uses Fast Refresh via patched Bun.Transpiler; Svelte/Vue use their native HMR runtimes; Angular uses View Transitions + a custom preserve-across-HMR layer.

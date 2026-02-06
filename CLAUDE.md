# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AbsoluteJS is a full-stack, type-safe meta-framework for building web applications with TypeScript. It provides universal server-side rendering (SSR) for multiple frontend frameworks (React, Svelte, Vue, HTML, HTMX) powered by Bun and Elysia.

## Commands

```bash
bun run typecheck   # TypeScript type checking (no emit)
bun run format      # Prettier formatting
```

## Architecture

### Build Pipeline (`src/core/build.ts`)

The central orchestrator. A single `build()` call scans, compiles, and bundles all frameworks:

1. **Path validation** → `validateSafePath()` prevents directory traversal
2. **React index generation** → creates hydration entry points in `indexes/`
3. **Asset copy** + optional **Tailwind compilation**
4. **Entry point scanning** → `scanEntryPoints()` globs each framework directory
5. **Framework compilation** → Svelte (`compileSvelte`), Vue (`compileVue`) each produce SSR + client variants
6. **Bun bundling** (3 passes): server (target=bun), client (target=browser, minified), CSS
7. **Manifest generation** → maps filenames (PascalCased via `toPascal`) to hashed asset paths
8. **HTML asset path updating** → regex-based injection of hashed paths
9. **Cleanup** → removes `compiled/` intermediates unless `preserveIntermediateFiles` is set

### Key Modules

- **`src/core/pageHandlers.ts`** — `handleReactPageRequest`, `handleSveltePageRequest`, `handleVuePageRequest`, `handleHTMLPageRequest`, `handleHTMXPageRequest`. Each renders SSR HTML with hydration scripts.
- **`src/core/lookup.ts`** — `asset(manifest, name)` resolves build manifest entries.
- **`src/build/`** — Individual compilation steps: `compileSvelte.ts`, `compileVue.ts`, `generateManifest.ts`, `generateReactIndexes.ts`, `scanEntryPoints.ts`, `updateAssetPaths.ts`.
- **`src/plugins/networking.ts`** — Elysia plugin for server startup with HOST/PORT config and LAN binding (`--host` flag).
- **`src/utils/`** — Path validation, string transforms (`toPascal`/`toKebab`), head element generation, environment variable loading (`getEnv`).
- **`src/types.ts`** — `BuildConfig`, `BuildOptions`, `PropsOf<T>`, `Prettify<T>`.

### Framework SSR Pattern

All frameworks follow the same pattern: server renders HTML → props serialized to `window.__INITIAL_PROPS__` → client hydrates with framework-specific entry point. Hydration indexes are auto-generated during build.

### Configuration Type

`BuildConfig` accepts optional directory paths for each framework (`reactDirectory`, `svelteDirectory`, `vueDirectory`, `htmlDirectory`, `htmxDirectory`), plus `buildDirectory`, `assetsDirectory`, `tailwind` config, and `options`.

## Code Conventions

- **ESLint plugin `eslint-plugin-absolute`** enforces strict rules: max nesting depth of 1, min variable name length of 3 (exceptions: `_`, `id`, `db`, `OK`), explicit return types, sorted exports/keys, no default exports (except config files)
- **Prettier**: 4-space tabs, 80 char width, single quotes, trailing commas off, semicolons on
- **TypeScript**: strict mode, ESNext target, bundler module resolution, decorator support enabled
- **Barrel exports**: `index.ts` files re-export alphabetically from each module directory
- **No default imports** from `react` or `bun` (enforced by linter)
- Elysia plugin pattern for server extensibility

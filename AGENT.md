## Project Overview

AbsoluteJS is a full-stack, type-safe meta-framework for building web applications with TypeScript. It provides universal server-side rendering (SSR) for multiple frontend frameworks (React, Svelte, Vue, HTML, HTMX, Angular) powered by Bun and Elysia.

## Commands

```bash
bun run typecheck   # TypeScript type checking (no emit)
bun run format      # Prettier formatting
bun run lint        # ESLint
bun test            # Run tests (do not run)
bun run dev         # Dev server (runs example/server.ts with --hot) (ask before using always)
bun run build       # Build the package to dist/ (do not run)
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

### Framework SSR Pattern

All frameworks follow the same pattern: server renders HTML → props serialized to `window.__INITIAL_PROPS__` → client hydrates with framework-specific entry point. Hydration indexes are auto-generated during build.
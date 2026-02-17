# HMR Architecture Changes: Per-Request Injection → Build-Time Baking

## TL;DR

We moved HMR client injection from **per-request** (TransformStream / regex on every response) to **build-time** (baked into generated index files and HTML during the dev build). This eliminates the `/__hmr-client.js` endpoint, removes all HMR-related logic from page handlers, and keeps React Fast Refresh working with state preservation via code splitting.

---

## What Eugene Built (Per-Request Injection)

Eugene's approach kept the HMR client completely separate from the build output. On every page request, the server injected HMR scripts into the response:

### How the HMR client reached the browser

1. `devBuild()` compiled `hmrClient.ts` into an IIFE string (`hmrClientBundle`)
2. `hmr()` plugin registered `GET /__hmr-client.js` to serve that bundle
3. Every page response was modified at serve time to include `<script src="/__hmr-client.js">`

### Per-framework injection in `pageHandlers.ts`

- **React** — A `TransformStream` piped through the SSR readable stream, scanning chunks for `<head>` and `</body>` to inject scripts (React Refresh stub, import map, HMR client tag)
- **Svelte** — HMR head/body content passed as options to the SSR renderer
- **Vue** — String concatenation appended HMR scripts to the head tag and body tail
- **HTML/HTMX** — Read file to string → regex injection of HMR scripts → respond with modified string

### React Fast Refresh setup

React was **externalized** in dev builds (`external: ['react', 'react-dom', ...]`) and loaded from `esm.sh` via an import map injected into `<head>`. This kept React as a singleton so `$RefreshReg$`/`$RefreshSig$` registrations from dynamic re-imports would feed into the same React instance. A stub in `<head>` defined the globals before any module code ran.

---

## What We Changed (Build-Time Baking)

### Why we moved away from per-request injection

The dev `build/` directory is **transient** — it's rebuilt from scratch on every change. Since we already generate framework-specific index files (React hydration indexes, Svelte bootstraps, Vue indexes), we can include the HMR client as an import in those files. The build already knows whether it's dev or production (`isDev`), so it can conditionally include HMR code. This means:

- **Page handlers become framework-agnostic** — no HMR awareness, no TransformStream, no regex injection. They just serve the build output.
- **No `/__hmr-client.js` endpoint** — one less route to maintain.
- **No `injectHMRClient.ts` module** — the three-function injection utility is gone.
- **No `hmrClientBundle` passed around** — `devBuild()` and `hmr()` have simpler signatures.

### How the HMR client reaches the browser now

| Framework     | Mechanism                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **React**     | `generateReactIndexes.ts` prepends `import 'hmrClient.ts'` to each generated index file when `isDev`. Bundled by Bun as part of the normal module graph.       |
| **Svelte**    | `compileSvelte.ts` prepends HMR import to the generated bootstrap file when `isDev`.                                                                           |
| **Vue**       | `compileVue.ts` prepends HMR import to the generated index file when `isDev`.                                                                                  |
| **HTML/HTMX** | `build.ts` calls `buildHMRClient()` once, then injects the IIFE inline as `<script data-hmr-client>` into each HTML file after copying to the build directory. |

### React Fast Refresh — no CDN, no external, no import maps

Eugene's approach externalized React and loaded it from `esm.sh` to keep a singleton instance. We eliminated that dependency:

1. **`reactFastRefresh: true`** in the Bun build config (dev only) — Bun injects `$RefreshReg$`/`$RefreshSig$` calls into component code
2. **`reactRefreshSetup.ts`** — imported first in the generated index, sets up the globals via `react-refresh/runtime` before any component modules initialize
3. **`splitting: true` + `_refresh.tsx` dummy entry** — forces React into a **shared chunk**. When HMR rebuilds, the component entry gets a new hash but the React chunk hash stays the same (its content didn't change). The browser reuses the cached React chunk module — **same React instance, no duplicate**.
4. **HMR handler** — dynamically imports the new entry URL (from the manifest), then calls `RefreshRuntime.performReactRefresh()`. Component state (counters, form inputs, etc.) is preserved.

### What `pageHandlers.ts` looks like now

```typescript
// React — just render and respond, no injection
const stream = await renderReactToReadableStream(element, {
	bootstrapModules: [index],
	bootstrapScriptContent: maybeProps
		? `window.__INITIAL_PROPS__=${JSON.stringify(maybeProps)}`
		: undefined
});
return withDevHeaders(new Response(stream, { headers }), headers);

// HTML/HTMX — just serve the file, HMR is already in it
return withDevHeaders(new Response(file(pagePath), { headers }), headers);
```

No TransformStream. No regex. No framework-specific branching for HMR.

---

## Side-by-Side Comparison

| Aspect                      | Before (per-request)                                                                       | After (build-time)                                            |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| HMR client delivery         | `<script src="/__hmr-client.js">` injected per response                                    | `import` in generated index files / inline `<script>` in HTML |
| React externalization       | Yes, via esm.sh import map                                                                 | No — React bundled, shared via code splitting                 |
| React Fast Refresh          | Stub in `<head>` + CDN runtime                                                             | `reactRefreshSetup.ts` module import                          |
| `pageHandlers.ts`           | TransformStream (React), template options (Svelte), string concat (Vue), regex (HTML/HTMX) | No HMR logic at all                                           |
| `/__hmr-client.js` endpoint | Yes                                                                                        | Removed                                                       |
| `injectHMRClient.ts`        | 3 exported functions                                                                       | Deleted                                                       |
| `devBuild()` signature      | Returns `hmrClientBundle`                                                                  | Does not                                                      |
| `hmr()` plugin signature    | Accepts `clientBundle` param                                                               | Does not                                                      |
| Code splitting (dev)        | Off                                                                                        | On (needed for singleton React)                               |

---

## Files Changed

### Removed

- `src/dev/injectHMRClient.ts` — per-request injection utility

### Added

- `src/dev/client/reactRefreshSetup.ts` — React Refresh runtime globals setup

### Modified

- `src/build/generateReactIndexes.ts` — HMR + refresh setup imports in dev, `_refresh.tsx` generation
- `src/build/compileSvelte.ts` — HMR import in generated bootstrap (dev)
- `src/build/compileVue.ts` — HMR import in generated index (dev)
- `src/core/build.ts` — `reactFastRefresh`, `splitting: true`, `_refresh.tsx` entry, HTML/HTMX build-time injection
- `src/core/pageHandlers.ts` — removed all HMR injection logic
- `src/core/devBuild.ts` — removed `hmrClientBundle` from result
- `src/plugins/hmr.ts` — removed `/__hmr-client.js` route and `clientBundle` param
- `src/dev/client/handlers/react.ts` — dynamic import + `performReactRefresh()` instead of page reload
- `src/dev/client/hmrClient.ts` — converted from IIFE to ES module

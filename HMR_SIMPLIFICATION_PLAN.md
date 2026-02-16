# HMR Simplification Plan

## Goal

Remove per-request HMR script injection. Bake the HMR client code directly into
each framework's generated index/bootstrap files during dev build. Remove the
`/__hmr-client.js` endpoint. The build folder is transient and never pushed — dev
builds include HMR, production builds don't.

## Key Insight: React Refresh

`build.ts` line 362 already sets `reactFastRefresh: isDev` which makes Bun emit
`$RefreshReg$`/`$RefreshSig$` calls in the bundled output. The only missing piece
is wiring the runtime — which can happen in the generated index file, not per-request
HTML injection. The esm.sh import map is unnecessary because Bun can bundle
`react-refresh/runtime` directly (it's already a devDependency).

---

## Steps

### Step 1: Convert `hmrClient.ts` from IIFE to ES module

**File:** `src/dev/client/hmrClient.ts`

- Remove the outer `(function() { ... })()` IIFE wrapper
- Keep the duplicate-connection guard (`if (window.__HMR_WS__) return`)
- The file becomes a standard side-effect ES module that sets up the WebSocket
  connection, message routing, and reconnection logic when imported

### Step 2: Add HMR imports to generated React index files

**File:** `src/build/generateReactIndexes.ts`

- Add `isDev` parameter to `generateReactIndexFiles(reactPagesDir, indexesDir, isDev)`
- When `isDev` is true, prepend to each generated `.tsx` file:
  ```ts
  import RefreshRuntime from 'react-refresh/runtime';
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshRuntime$ = RefreshRuntime;
  window.$RefreshReg$ = (type, id) => RefreshRuntime.register(type, id);
  window.$RefreshSig$ = () => RefreshRuntime.createSignatureFunctionForTransform();
  window.__HMR_FRAMEWORK__ = "react";
  import '../dev/client/hmrClient';
  ```
- When `isDev` is false (production), none of this is included
- The `$RefreshSig$`/`$RefreshReg$` stubs that were in `getHMRHeadScripts` are
  no longer needed — the real implementations are set up before hydration runs
- Remove `const isDev = true;` hardcoded line (use the actual flag)
- The import path for hmrClient needs to resolve relative to the indexes directory
  to wherever the client source lives. Since Bun bundles from source, use an
  absolute or configured path.

### Step 3: Add HMR imports to generated Svelte bootstrap

**File:** `src/build/compileSvelte.ts`

- Pass `isDev` into the Svelte compilation function
- In the generated bootstrap code (~line 207), when `isDev`:
  ```ts
  window.__HMR_FRAMEWORK__ = "svelte";
  import '...hmrClient';
  ```
- These go at the top of the bootstrap before the component mount code

### Step 4: Add HMR imports to generated Vue index

**File:** `src/build/compileVue.ts`

- Pass `isDev` into the Vue compilation function
- In the generated index code (~line 264), when `isDev`:
  ```ts
  window.__HMR_FRAMEWORK__ = "vue";
  import '...hmrClient';
  ```

### Step 5: Handle HTML/HTMX pages

HTML and HTMX pages have no generated index files — they're plain `.html` files.
Two options (pick one):

**Option A (recommended):** Keep a slimmed-down inline injection for HTML/HTMX only.
Rewrite the injection to embed the HMR client as an inline `<script>` (the bundled
text, not a `<script src>`). This means `buildHMRClient` survives but only for
HTML/HTMX, and the bundled text is inserted into the HTML at dev-build time or
at request time. This is the smallest change that works.

**Option B:** At dev-build time, copy HTML/HTMX files into the build directory and
inject the inline HMR script during the copy. Handlers then serve the build copy
as-is. Cleaner at runtime but more build complexity.

### Step 6: Remove per-request injection from page handlers

**File:** `src/core/pageHandlers.ts`

- Remove imports: `getHMRBodyScripts`, `getHMRHeadScripts`, `injectHMRClient`
- **React handler:** Remove the entire `TransformStream` HMR injection block
  (~lines 73-127). The handler always returns the plain SSR stream. The HMR client
  is loaded by the index file that React's `bootstrapModules` points to.
- **Svelte handler:** Remove `hasHMR()` ternaries for `headContent`/`bodyContent`
- **Vue handler:** Remove `hasHMR()` ternaries for head/body injection
- **HTML/HTMX handlers:** If using Option A from Step 5, keep a simplified inline
  injection. If Option B, remove all injection.
- Keep `hasHMR()` and `withDevHeaders()` if still needed for cache-control headers

### Step 7: Remove the `/__hmr-client.js` endpoint

**File:** `src/plugins/hmr.ts`

- Remove the `GET /__hmr-client.js` route (lines 33-43)
- Remove `clientBundle` from the function signature: `hmr(hmrState, manifest)`
- Keep the WebSocket `/hmr` and `GET /hmr-status` endpoints as-is

### Step 8: Remove standalone HMR client build

**File:** `src/dev/buildHMRClient.ts` — **Delete this file** (unless kept for
HTML/HTMX inline injection per Step 5 Option A)

**File:** `src/core/devBuild.ts`

- Remove `import { buildHMRClient }`
- Remove `const hmrClientBundle = await buildHMRClient()` call
- Remove `hmrClientBundle` from the return object
- Pass `isDev: true` through to build steps so index generators know to include HMR
  (or have `devBuild` call the generators directly with the flag)

### Step 9: Delete `injectHMRClient.ts`

**File:** `src/dev/injectHMRClient.ts` — **Delete this file** (unless a slim
version is retained for HTML/HTMX per Step 5 Option A)

### Step 10: Update wiring in example server

**File:** `example/server.ts`

- Simplify the guard: remove `result.hmrClientBundle` check
- Update call: `server.use(hmr(result.hmrState, result.manifest))`

---

## Files Summary

| File | Action |
|------|--------|
| `src/dev/client/hmrClient.ts` | Modify — remove IIFE wrapper |
| `src/build/generateReactIndexes.ts` | Modify — add `isDev` param, add React Refresh + HMR client imports |
| `src/build/compileSvelte.ts` | Modify — add `isDev` param, add HMR client import to bootstrap |
| `src/build/compileVue.ts` | Modify — add `isDev` param, add HMR client import to index |
| `src/core/pageHandlers.ts` | Modify — remove all HMR injection logic (~80 lines removed) |
| `src/plugins/hmr.ts` | Modify — remove `/__hmr-client.js` route, drop `clientBundle` param |
| `src/dev/buildHMRClient.ts` | Delete (or retain for HTML/HTMX only) |
| `src/core/devBuild.ts` | Modify — remove `buildHMRClient` call, pass `isDev` to build |
| `src/dev/injectHMRClient.ts` | Delete (or retain slim version for HTML/HTMX only) |
| `example/server.ts` | Modify — update `hmr()` call |

## Import Path Resolution Note

The generated index files (in `indexes/`) need to import `hmrClient.ts` from
`src/dev/client/`. Since Bun resolves imports at bundle time from source, use a
path relative to the indexes directory or an absolute path. Test that Bun's bundler
correctly picks up and bundles the hmrClient module (and `react-refresh/runtime`
for React) into the client output during the client build pass.

## What This Eliminates

- `injectHMRClient.ts` (entire file)
- `buildHMRClient.ts` (entire file or reduced to HTML/HTMX only)
- ~55 lines of TransformStream code in React handler
- Per-request HMR injection in all 5 framework handlers
- The `/__hmr-client.js` HTTP endpoint
- The esm.sh import map for react-refresh
- The `$RefreshSig$`/`$RefreshReg$` stub script
- The `data-hmr-client` double-injection guard

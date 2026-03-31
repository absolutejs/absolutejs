# Dev Server Asset Cache Issue

## Problem

The dev server serves static assets (images, SVGs, fonts, etc.) with production-level cache headers:

```
Cache-Control: public, max-age=86400
```

This tells the browser to cache the asset for 24 hours. During development, if you change a static asset (e.g., replace an SVG logo), the browser continues serving the old cached version even after:

- Ctrl+Shift+R (hard refresh)
- "Disable cache" enabled in DevTools
- Closing and reopening the tab
- Deleting the `build/` directory and restarting the dev server

This happens because browsers aggressively cache subresources (images loaded via `<img>` tags) separately from the main page. The `ETag` header causes the browser to revalidate but still use the cached body if the server responds with the same ETag.

## Workarounds (for now)

1. **Incognito window** — always works since it has a fresh cache
2. **Navigate directly to the asset URL** (e.g., `http://localhost:3000/assets/svg/logo.svg`), hard refresh that specific URL, then go back to the main page
3. **Clear browser cache entirely** — Settings → Clear browsing data → Cached images and files

## Fix

The dev server should use `Cache-Control: no-cache` or `Cache-Control: max-age=0, must-revalidate` for all static assets when running in dev mode. This ensures the browser always checks with the server for fresh content during development while still allowing ETags for efficient revalidation.

### Where to fix

The asset serving happens in the HMR plugin (`src/plugins/hmr.ts`) where `onBeforeHandle` returns responses for static assets. The `Cache-Control` header is set to `public, max-age=31536000, immutable` for assets served from the asset store. In dev mode, this should be `no-cache` instead.

The asset copy step in the build pipeline (`src/core/build.ts` and `src/core/devBuild.ts`) copies files from the `assetsDirectory` to the `buildDirectory`. The dev server then serves these via the HMR plugin's asset store or Elysia's static file handling — both of which set long cache TTLs.

### Suggested change

In `src/plugins/hmr.ts`, when returning asset responses, check if we're in dev mode and use appropriate cache headers:

```ts
// Dev mode: no-cache so asset changes are picked up immediately
// Prod mode: immutable with content hash in filename
const cacheHeader = isDev
  ? 'no-cache'
  : 'public, max-age=31536000, immutable';
```

# Angular Page Handler Optimization

## Overview

The Angular SSR page handler (`src/angular/pageHandler.ts`) was refactored from 475 lines to 430 lines, with the handler body itself shrinking from ~450 lines to ~120 lines. The primary goal was performance: moving static, per-process work out of the per-request hot path.

## What changed

### 1. Lazy singleton for Angular dependencies

**Before:** Every SSR request ran 8 dynamic imports in a `Promise.all`:

```ts
// Ran on EVERY request
await import('@angular/compiler');
const [...] = await Promise.all([
    import('./angularPatch'),
    import('@angular/platform-browser'),
    import('@angular/platform-server'),
    import('@angular/common'),
    import('@angular/core'),
]);
const { getAndClearClientScripts, generateClientScriptCode } =
    await import('../utils/registerClientScript');
```

**After:** A cached promise resolves all Angular packages once on first request. Subsequent requests get the already-resolved promise back immediately:

```ts
let angularDeps: Promise<AngularDeps> | null = null;
const getAngularDeps = () => {
    if (!angularDeps) {
        angularDeps = loadAngularDeps();
    }
    return angularDeps;
};
```

The `registerClientScript` utilities are now static imports at the top of the file since they have no Angular dependency and are safe to load eagerly.

### 2. SSR Sanitizer moved to module scope

**Before:** The `SsrSanitizer` class was defined inside the handler and a new instance was created per request. Since it extends `DomSanitizer` (which comes from the lazy import), the class definition is deferred until after the first `getAngularDeps()` call resolves, but then cached permanently:

**After:** `getSsrSanitizer(deps)` builds the class once and returns the same singleton on every subsequent call. The sanitizer is stateless, so sharing one instance is safe.

### 3. Domino document creation extracted to helper

The ~150 lines of Domino DOM patching (head creation, querySelectorAll/querySelector polyfills, children property fixes) were extracted into a standalone `createDominoDocument(htmlString, domino)` function at module scope. This doesn't change *when* it runs (it needs per-request HTML), but it cleans up the handler body and makes the logic reusable.

### 4. DominoAdapter initialization runs once

**Before:** `DominoAdapter.makeCurrent()` was called inside the handler on every request.

**After:** It runs once inside `loadAngularDeps()` during the one-time initialization.

### 5. HTML injection deduplicated

The repeated `</body>` / `</html>` replacement pattern (used for both client scripts and hydration index injection) was extracted into an `injectBeforeClose(html, snippet)` helper.

### 6. Static import of angularPatch removed

**Before:** `pageHandler.ts` had `import { createDocumentProxy } from './angularPatch'` as a static import. Since `angularPatch.ts` has a top-level await IIFE that imports `@angular/platform-server`, this caused `@angular/platform-server` to load at module evaluation time — before `@angular/compiler` was available — crashing with `JIT compilation failed for injectable [class PlatformLocation]`.

**After:** `createDocumentProxy` (which was just `(doc) => doc`) is inlined in `pageHandler.ts`. The `angularPatch` module is only loaded dynamically inside `loadAngularDeps()`, after the compiler is ready.

## Performance impact

### Per-request cost eliminated

The table below estimates the work saved on every request after the first one. These are the operations that previously ran per-request and now run once at startup:

| Operation | Estimated cost | Frequency before | Frequency after |
|---|---|---|---|
| `import('@angular/compiler')` | 15-40ms | Every request | Once |
| `import('@angular/platform-browser')` | 10-25ms | Every request | Once |
| `import('@angular/platform-server')` | 10-25ms | Every request | Once |
| `import('@angular/common')` | 5-15ms | Every request | Once |
| `import('@angular/core')` | 10-25ms | Every request | Once |
| `import('./angularPatch')` + await | 5-15ms | Every request | Once |
| `import('domino')` | 3-8ms | Every request | Once |
| `import('../utils/registerClientScript')` | 1-3ms | Every request | Once (static) |
| `DominoAdapter.makeCurrent()` | <1ms | Every request | Once |
| `SsrSanitizer` class definition | <1ms | Every request | Once |
| `new SsrSanitizer()` instantiation | <1ms | Every request | Once |

While Bun caches ES module evaluations (so re-importing the same specifier doesn't re-parse the file), there is still overhead per `import()` call: module graph lookup, promise allocation, and microtask scheduling. With 8 dynamic imports, this overhead is measurable.

### Estimated savings

**First request:** Roughly the same as before — initialization cost is unavoidable. The `Promise.all` for the 5 Angular packages runs in parallel just like before.

**Subsequent requests:** The 8 dynamic imports and their `Promise.all` coordination are replaced by a single `await` on an already-resolved promise. Estimated savings:

- **Conservative (warm module cache):** 5-15ms per request. Even cached `import()` calls have promise allocation and microtask overhead. Eliminating 8 of them adds up.
- **Realistic (typical server):** 15-40ms per request. Under memory pressure or when the module cache is cold (e.g. after garbage collection), re-resolving modules takes longer.
- **Class/instance allocation:** <1ms saved, but it eliminates garbage collection pressure from creating a new `SsrSanitizer` class + instance per request.

### At scale

For a server handling Angular SSR under load:

| Requests/sec | Saved per request | Total savings/sec |
|---|---|---|
| 10 | ~15ms | ~150ms of CPU time |
| 50 | ~15ms | ~750ms of CPU time |
| 100 | ~15ms | ~1.5s of CPU time |

This translates directly to reduced p50/p99 latencies since the saved time is on the critical path of every response.

### What still runs per-request

These operations are inherently per-request and were not changed:

- `import(pagePath)` — the user's page component (unique per route)
- InjectionToken discovery loop
- Domino document creation (needs per-request HTML string)
- Provider array construction
- `renderApplication()` — Angular's actual SSR render
- Client script collection + HTML injection
- Response construction

## Files modified

- `src/angular/pageHandler.ts` — main refactor
- `src/angular/angularPatch.ts` — no changes (consumed differently)

---

## Round 2: HMR & Request-Time Cleanup

A follow-up pass focused on moving remaining build-time work out of the request path, fixing an HMR bug, and making the HMR client faster.

### 7. Domino polyfills moved to one-time prototype patch

**Before:** Every SSR request ran ~100 lines of DOM polyfills inside `createDominoDocument()` — patching `querySelector`, `querySelectorAll`, and `children` onto each individual document's head element via `Object.defineProperty`.

**After:** `querySelector` and `querySelectorAll` are patched once on domino's `HTMLHeadElement.prototype` during `loadAngularDeps()`. Since these are inherited by all head elements created by domino, individual documents get them automatically. Only the `children` property (which depends on the actual child nodes of each document) is still patched per-request.

This eliminates ~6 `Object.defineProperty` calls and their `try/catch` wrappers from every request.

### 8. Component selector cached per route

**Before:** Every request read the selector from `ɵcmp.selectors` or fell back to decorator annotations — a chain of property lookups and a loop over annotations.

**After:** The resolved selector is cached in a `Map<string, string>` keyed by `pagePath`. Computed once per component, returned from cache on all subsequent requests.

### 9. Last-used props cache for HMR (Vite/Next behavior)

**Before:** `simpleAngularHMR.ts` hardcoded `{ initialCount: 0 }` as props for every HMR re-render. If the user navigated to a route with dynamic data (from a DB query, request params, etc.), HMR would wipe it and show default values.

**After:** `handleAngularPageRequest` caches `{ props, headTag }` per route on every real request in a `Map`. During HMR, `simpleAngularHMR.ts` calls `getCachedRouteData(serverPath)` to replay the last-seen props and head tag. This matches how Vite and Next.js handle HMR — the user sees the same data they had before the edit, not a reset to defaults.

Cache keys strip query strings (`pagePath.split('?')[0]`) so cache-busted HMR paths match the original manifest paths from real requests.

### 10. CSS-only changes no longer trigger full SSR re-render

**Before:** In `rebuildTrigger.ts`, when a CSS-only change was detected, the code broadcast a `style` update to the client (correct) but then fell through to the full SSR re-render loop below it (unnecessary). Every `.css` save caused both a lightweight stylesheet swap AND a full destroy-bootstrap-render cycle.

**After:** The CSS-only broadcast and the full re-render are now in an `if/else` — CSS changes only do the stylesheet swap, everything else does the SSR re-render. This is a significant HMR speed improvement for style iterations.

### 11. Polling replaced with event-based detection

**Before:** `waitForAngularApp()` in the HMR client polled `window.__ANGULAR_APP__` every 1ms via `setInterval` for up to 500 attempts. This burned CPU and added up to 1ms latency per HMR update.

**After:** Uses `Object.defineProperty` to install a setter trap on `window.__ANGULAR_APP__`. When Angular's bootstrap code writes `window.__ANGULAR_APP__ = appRef`, the setter fires and resolves the promise instantly — zero polling. The setter restores the property as a normal writable value after firing so subsequent writes work normally. A 500ms `setTimeout` acts as a safety net fallback.

### 12. Dynamic imports removed from HMR hot path

**Before:** The Angular HMR section in `rebuildTrigger.ts` used `await import('node:path')` and `await import('../utils/stringModifiers')` inside the loop body on every HMR update, even though `basename` was already a top-level import and `toPascal` could be.

**After:** `toPascal` is now a top-level import. The redundant dynamic imports of `node:path`, `../utils/stringModifiers`, and `./dependencyGraph` (also already imported at the top) were removed. This eliminates unnecessary promise allocations on every file save during development.

### Updated: what still runs per-request

After both rounds, the per-request work is now:

- `import(pagePath)` — the user's page component (unique per route, cache-busted during HMR)
- InjectionToken discovery loop
- Domino document creation + `children` property patch
- Provider array construction
- `renderApplication()` — Angular's actual SSR render
- Client script collection + HTML injection
- Response construction

Everything else (Angular deps, DominoAdapter, sanitizer, domino prototype polyfills, component selectors) is computed once and cached.

## Files modified (round 2)

- `src/angular/pageHandler.ts` — domino prototype patches, selector cache, props cache
- `src/dev/simpleAngularHMR.ts` — reads cached props instead of hardcoding defaults
- `src/dev/rebuildTrigger.ts` — CSS-only early exit, top-level imports
- `src/dev/client/handlers/angular.ts` — event-based `waitForAngularApp`

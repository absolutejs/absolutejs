# Fix: React HMR on macOS

React HMR updates were detected and logged on macOS (`[hmr] hmr update ...`), but changes never appeared in the browser. CSS hot-swaps worked fine. HTML, Svelte, Vue, and HTMX HMR were unaffected. Two issues were identified and fixed.

## Files Changed

| File | Change |
|------|--------|
| `src/dev/rebuildTrigger.ts` | Moved `populateAssetStore` + `cleanStaleAssets` before broadcasts |
| `src/build/generateReactIndexes.ts` | Added `reactRefreshSetup` import to `_refresh.tsx` shared chunk seed |

---

## Issue 1: Asset Store Race Condition

**File:** `src/dev/rebuildTrigger.ts`

### Problem

After a rebuild, the server broadcast the `react-update` WebSocket message to the browser *before* `populateAssetStore()` loaded the new bundles into the in-memory asset store. The client received the message, immediately called `import()` on the new bundle URL, and hit the server — which couldn't serve the file yet.

```
Build completes → broadcast (react-update) → client import() → 404/stale ← populateAssetStore (too late)
```

### Why HTML/Svelte/Vue/HTMX HMR were unaffected

Those frameworks send the rendered HTML *inline* in the WebSocket message. The browser applies it via DOM manipulation — no follow-up HTTP request needed.

### Why macOS specifically

macOS FSEvents and I/O scheduling produce a wider timing window between the broadcast and the `import()` arrival than Linux's inotify. On Linux the asset store was usually populated before the request landed; on macOS it consistently wasn't.

### Fix

Moved both calls to *before* the first `broadcastToClients`:

```typescript
// After build succeeds and manifest is validated:
await populateAssetStore(state.assetStore, manifest, state.resolvedPaths.buildDir);
await cleanStaleAssets(state.assetStore, manifest, state.resolvedPaths.buildDir);

// Now safe to tell clients about the update:
broadcastToClients(state, { ... });
```

The previous comment warned this could trigger a Bun `--hot` restart before broadcasts. That concern was unfounded — `populateAssetStore` only reads files into a `Map` and does not modify source modules. The build (which writes to disk) has already finished, so any `--hot` restart is already queued regardless.

---

## Issue 2: React Fast Refresh Initialization Order

**File:** `src/build/generateReactIndexes.ts`

### Problem

Even with the asset store fix, `performReactRefresh()` silently did nothing. The new bundle was fetched and executed, but React Fast Refresh couldn't reach React's reconciler to swap the components.

React Fast Refresh requires `react-refresh/runtime` to call `injectIntoGlobalHook(window)` **before** React initializes. This patches `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` so React registers its internals with the Refresh Runtime during initialization. If React initializes first, it never connects — and `performReactRefresh()` becomes a no-op.

The build produces two kinds of client entry points:

- **`_refresh.tsx`** (shared chunk seed) — only imported `react` and `react-dom/client`
- **Hydration indexes** (e.g., `ReactExample.tsx`) — imported `reactRefreshSetup`, then React

With `splitting: true`, Bun extracts common dependencies into a shared chunk. `react` and `react-dom/client` were common to both → shared chunk. But `reactRefreshSetup` was only in the hydration indexes → stayed in the per-entry chunk.

```
Shared chunk executes first:
  react initializes → checks __REACT_DEVTOOLS_GLOBAL_HOOK__ → not patched yet → skips

Entry chunk executes second:
  reactRefreshSetup runs → patches the hook → too late
```

### Why CSS updates still worked

CSS HMR uses `reloadReactCSS()` which swaps `<link>` stylesheet `href` attributes in the DOM. No `import()`, no React reconciler, no Fast Refresh involved.

### Why macOS was affected but Linux/Windows worked

The Bun bundler's chunk splitting heuristics and module ordering within chunks can vary based on file system glob ordering. macOS (case-insensitive APFS) and Linux (case-sensitive ext4) produce different glob orders, which can affect whether `reactRefreshSetup` ends up in the shared chunk or the entry chunk. On Linux it happened to land in the shared chunk; on macOS it consistently didn't.

### Fix

Added the `reactRefreshSetup` import to `_refresh.tsx` so it becomes a common dependency and lands in the shared chunk — *before* React:

```typescript
// Before:
import 'react';
import 'react-dom/client';

// After:
import '...reactRefreshSetup.ts';  // patches the global hook
import 'react';                     // React initializes, sees the hook
import 'react-dom/client';
```

Since `reactRefreshSetup` is now imported by both `_refresh.tsx` and every hydration index, Bun extracts it into the shared chunk alongside React. The import order within the chunk guarantees the hook is patched before React initializes.

`reactRefreshSetup` is idempotent (guarded by `if (!window.$RefreshRuntime$)`), so the additional import site is harmless. Component state is fully preserved across HMR updates via React Fast Refresh.

---

## Verified Behavior

All tested on macOS after applying both fixes:

- Editing a React page component (`ReactExample.tsx`) — change appears live, state preserved
- Editing a shared component (`App.tsx`) — change appears live via dependency graph
- Editing a CSS file (`react-example.css`) — style updates without page reload
- HTML, Svelte, Vue, HTMX HMR — all continue to work as before
- `bun run typecheck` — passes with no errors

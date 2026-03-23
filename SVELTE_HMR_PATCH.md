# Svelte HMR State Preservation

## Status

PR submitted to Svelte: https://github.com/sveltejs/svelte/pull/17995

## What it does

Preserves `$state` values across HMR component swaps. Without the patch, editing a Svelte component resets all `$state` to initial values. With it, state is captured before destroy and restored during re-initialization — matching React Fast Refresh and Vue's `rerender()`.

## When the PR gets merged

Once the PR is merged and a new Svelte version is published:

1. Update svelte: `bun install svelte@latest`
2. That's it — AbsoluteJS already compiles with `hmr: true` and uses the `__SVELTE_HMR_ACCEPT__` registry. The runtime state preservation is handled entirely by Svelte's `$.hmr()` and `$.tag()` internals.

## To test with the patch NOW (before merge)

Apply the patch from the fork to your local node_modules:

```bash
# Copy patched files from the fork
cp ~/alex/svelte-hmr-preserve/packages/svelte/src/internal/client/dev/hmr.js \
   node_modules/svelte/src/internal/client/dev/hmr.js

cp ~/alex/svelte-hmr-preserve/packages/svelte/src/internal/client/dev/tracing.js \
   node_modules/svelte/src/internal/client/dev/tracing.js

# NOTE: The fork uses the v5.55.0 API (1-arg hmr(fn)).
# AbsoluteJS uses v5.35.2 (2-arg hmr(original, get_source)).
# Use the v5.35.2-compatible patch at /tmp/hmr-patch-5.35.js instead:
cp /tmp/hmr-patch-5.35.js node_modules/svelte/src/internal/client/dev/hmr.js
```

These changes are lost on `bun install` — they only live in node_modules.

## Current behavior WITHOUT the patch

- Svelte HMR works (component swaps via `$.hmr()`)
- `$state` resets to initial value on every HMR swap
- This is Svelte 5's default behavior

## Benchmarks with the patch

- Counter P50: 17ms (was 22ms — no tracking effect overhead)
- Page P50: 16ms
- State preserved across 30+ rapid edits
- Zero spikes over 100ms

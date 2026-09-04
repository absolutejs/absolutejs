# Snappy dev plan

Making `absolute dev` fast on a large real app. The reference workload is
`dealroom` — a Vue-heavy project with hundreds of SFCs — measured with
`ABSOLUTE_DEV_PROFILE=1`.

## Measured end to end

| | Baseline (beta.70) | After |
| --- | --- | --- |
| Build trace | 122s | — |
| First `200` | 166s (loaded box) | 12.2s (idle box) |
| First `503` (port bound) | — | 3.7s |
| Ready | — | 5.6s |
| Home page, built on demand | — | 1.3s |

The baseline was taken on a loaded box and the "after" run on an idle
one, so the two totals are not a clean A/B — the per-workstream numbers
below are.

## Workstreams

**WS1 — early listen.** Bind the port during the boot build and answer
`503` + `Retry-After` instead of refusing connections. Opt out with
`ABSOLUTE_EARLY_LISTEN=0`.

**WS2 — post-processing.** 69.7s → 12.0s; build directory 491 MB → 206 MB.

**WS3 — dev page bundles.** Pages 395 MB → 149 MB, and the sourcemap
chain 14.7s → 4.1s.

**WS4 — single client-rewrite pass.** Asset-path rewriting collapsed from
several passes to one: 5.9s → 0.86s.

**WS5 — build worker pool.** `@vue/compiler-sfc` and the dev sourcemap
chain moved onto Bun `Worker` threads: cold compile 45s → 26s, pages
149 MB → 37 MB. `ABSOLUTE_BUILD_WORKERS=n` overrides the pool size;
`0`/`1` runs every job inline.

**WS6 — on-demand page builds.** Pages build on first request instead of
at boot: ready 56s → 5.5s. `--eager` / `ABSOLUTE_DEV_EAGER=1` restores
the boot build.

**WS7a — Link prefetch.** A framework-neutral prefetch primitive
(`src/client/prefetch.ts`) behind React / Vue / Svelte `<Link>`s, plus
`Metadata.preload` and `Metadata.speculationRules` in the head.

**WS7b — instant navigation.** The `application/vnd.absolute.route+json`
route-data media type: a hovered `<Link>` fetches the document and the
route data together, and the payload names the page's client module and
stylesheets so they are `modulepreload`ed / prefetched before the click.
Cacheable with an `ETag`, so a prefetch and the navigation that follows
it revalidate with a `304`.

**WS8 — boot timing.** Module-server prewarm, vendor caching and the
remaining boot-path work.

## Also shipped

- A restart-surviving Vue compile cache (`.absolutejs/compile-cache/vue/`,
  `ABSOLUTE_COMPILE_CACHE=0` to disable).
- Dev SSR bundles leave resolvable `node_modules` packages external
  (`dev.bundleServerDependencies` to force-bundle).
- Shared chunks (`splitting: true`) in the dev client bundle.

See `docs/DEV_PERFORMANCE.md` for the knobs and how to profile.

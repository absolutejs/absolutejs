# The dev toolbar

A development-only toolbar, in the page, showing what that page is made
of. It appears as a small pill in the bottom-right corner while
`absolute dev` is running, and never in a production build.

`shift` + `alt` + `D` toggles it, as does clicking the pill. Whether it is
open, and which panel, is remembered per browser.

## Panels

**Page** — which framework rendered this document, and every island on it
with its component name, framework, hydrate strategy and persist key.

That table is the reason this is a toolbar and not a route. Which islands
are on *this* page, of which frameworks, is something a separate document
cannot see. It is also the one view no other devtools can give you: React
DevTools sees React and Vue DevTools sees Vue, and neither can show a
Svelte island inside a React page.

Nothing new is instrumented for it — every island already carries
`data-component`, `data-framework`, `data-hydrate` and
`data-absolute-persist` in the markup the server and the client both
produce (`core/islandMarkupAttributes.ts`).

**HMR** — recent hot updates: the file, the kind, the outcome and the
total milliseconds. This reads `window.__ABS_HMR_APPLIES__`, the capped
buffer the HMR client has always kept and persists to `sessionStorage`, so
the log survives a reload. The panel re-renders as updates land.

**Network** — how many routes the server has registered, and the most
recent requests, from `/__absolute/routes` and `/__absolute/requests` —
the same endpoints `absolute routes` and `absolute inspect` read.

## What this replaces

This document used to describe "Absolute Studio": a dashboard at
`/__absolute_studio`, with an introspection API at `/__absolute_dev/*`, a
state registry fed by `window.__ABS_STATE_REGISTRY__`, and SSR metrics via
`window.__MEASURE_HYDRATION__`.

**None of it existed.** Not the route, not the API, not either global. The
document described all of it in the present tense, so anyone following it
got a 404.

What was true is that most of the *data* existed, under a different
namespace: `/__absolute/routes`, `/__absolute/requests` and
`/__absolute/vitals/summary` are real and already powered CLI commands.
The toolbar reads those rather than adding a second introspection API.

## Not built, deliberately

**An element-to-component inspector** — clicking a DOM node and being told
which component rendered it. That needs per-framework instrumentation in
every page handler, and it is the expensive half of this. It is not here,
and this document no longer implies it is.

**A state registry** — inspecting and editing global application state.
The same applies.

Both are worth building. Neither is pretended.

## How it stays out of the way

- It mounts on `documentElement`, not `body`, because a soft navigation
  **replaces the body** — a toolbar inside it disappears on the first
  navigation.
- It renders in a **shadow root**, so its styles cannot reach your page
  and your page's cannot reach it. A dev tool that restyles the app it is
  inspecting is worse than no dev tool.
- Installing is idempotent. A soft navigation re-runs the page's module
  entries, so the install runs again on every visit; without a guard each
  one would add another keydown handler and another HMR subscription — the
  accumulation that once made an island mount per visit *squared*.
- Collapsed it is a pill, not a panel. It is `position: fixed`, so it
  shifts nothing and does not move the CLS or LCP the vitals badge is
  reporting from the other corner.
- It is dark regardless of the page's theme, like a browser's own
  devtools, so it reads as a tool rather than as part of the app.

## Scope

Web only. A native shell has no page to inspect in this sense and nowhere
sensible to put a floating pill, so the toolbar is not installed there.

It ships only in the dev client bundle (`src/dev/client/`), which a
production build does not include.

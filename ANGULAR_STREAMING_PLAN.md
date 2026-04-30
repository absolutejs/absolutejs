# Angular Streaming SSR Investigation Plan

The goal is to decide whether AbsoluteJS should:

1. Continue treating Angular streaming as an AbsoluteJS slot / `@defer`
   transport feature.
2. Build a deeper Angular-specific progressive SSR implementation.
3. Upstream a PR to Angular if the right abstraction belongs there.

## Problem statement

React exposes `renderToReadableStream`, which can flush an initial shell while
async work is still pending and continue sending chunks as they resolve.
AbsoluteJS can directly use that primitive for React page responses.

Angular 21.2.6 does not expose an equivalent public renderer for the Angular
component tree. The low-level public `renderApplication` API still returns a
`Promise<string>`, and the higher-level `AngularAppEngine.handle()` API returns a
web `Response`.

The confusing part is that Angular's new SSR engine does use a
`ReadableStream` internally for server responses, but current local inspection
shows the stream waits for Angular to finish rendering the full HTML before it
enqueues the content. That is useful response streaming / header flushing, but
it is not React-style progressive component streaming.

## What AbsoluteJS supports today

AbsoluteJS already supports real out-of-order Angular streaming through its own
transport:

- `abs-stream-slot` registers a server-side slot, renders fallback HTML in the
  initial document, and patches resolved HTML into the matching slot as each
  resolver completes.
- Angular `@defer` blocks are lowered into the same slot transport, so users can
  write Angular-shaped markup and still get out-of-order server patches.
- The example at `~/alex/absolutejs-out-of-order-streaming-example` demonstrates
  both models:
    - `src/frontend/angular/pages/angular-streaming-host.ts`
    - `src/frontend/angular/pages/angular-defer-host.ts`

This is not the same as native Angular renderer streaming. It is an AbsoluteJS
streaming layer around Angular-rendered documents.

## Relevant Angular research

### Current public API

- Angular `renderApplication` is documented as rendering to a string and
  returning `Promise<string>`:
  https://angular.dev/api/platform-server/renderApplication
- Angular `AngularAppEngine.handle()` returns `Promise<Response | null>`:
  https://angular.dev/api/ssr/AngularAppEngine
- Angular SSR guide documents hybrid rendering, server routes, redirects,
  request/response tokens, and transfer cache:
  https://angular.dev/guide/ssr

### Local Angular 21.2.6 package inspection

Installed package version in this repo:

- `@angular/core`: `21.2.6`
- `@angular/platform-server`: `21.2.6`

Observed exports:

- `@angular/platform-server` exposes `renderApplication`, `renderModule`, and
  internal `ɵrenderInternal`.
- `@angular/ssr` exposes `AngularAppEngine`, `provideServerRendering`,
  `withRoutes`, `withAppShell`, and internal engine helpers.

Observed implementation shape in `node_modules/@angular/ssr/fesm2022/ssr.mjs`:

- `renderAngular(...)` bootstraps Angular.
- It waits for `applicationRef.whenStable()`.
- It returns a `content()` function.
- `content()` later calls Angular's internal `_renderInternal(...)`.
- For SSR mode, `AngularServerApp` creates a `ReadableStream`, but the stream
  does:
    - `const renderedHtml = await result.content();`
    - inline critical CSS
    - enqueue final HTML
    - close

So the current stream appears to wrap a completed render rather than exposing
progressive Angular component output.

### Upstream issues, PRs, and RFCs

- Angular CLI PR #31265, "disable streaming when rendering SSG page":
  https://github.com/angular/angular-cli/pull/31265

    - Merged September 22, 2025.
    - The patch says streaming is used to send the response before finishing
      rendering / inlining critical CSS.
    - It still awaits `result.content()` before enqueueing HTML.

- Angular RFC #57664, "Incremental Hydration":
  https://github.com/angular/angular/discussions/57664

    - Completed and shipped as developer preview in Angular 19.
    - Uses `@defer` blocks as hydration boundaries.
    - Server renders content, then the client leaves selected blocks dehydrated
      until hydration triggers fire.
    - This improves shipped JS and hydration cost, but it is not server-side
      progressive HTML streaming.

- Angular Resource RFC #60120:
  https://github.com/angular/angular/discussions/60120

    - Describes Angular's async future through `resource()` / `httpResource()`.
    - Explicitly mentions giving Angular better visibility into data dependencies
      across SSR and client navigations.
    - This could become relevant for future progressive SSR, but it is not a
      streaming renderer API today.

- Angular issue #67785, "SSR/Prerendering + Hydration for document fragments":
  https://github.com/angular/angular/issues/67785

    - Open enhancement.
    - Requests fragment hydration and a possible `renderApplicationParts(...)`
      style API.
    - This is more about islands / fragment rendering than streaming, but it is
      highly relevant to AbsoluteJS.

- Angular issue #46719, "speed up ssr ideas":
  https://github.com/angular/angular/issues/46719
    - Closed as not actionable.
    - Discusses SSR performance, Bun/runtime ideas, and warm-render approaches.
    - Does not establish an active Angular streaming renderer plan.

## Working conclusion

There is no clear public Angular 21 equivalent of React's
`renderToReadableStream`.

AbsoluteJS should not claim that Angular has native progressive SSR streaming
today. AbsoluteJS should claim that it supports Angular out-of-order streaming
through `abs-stream-slot` and Angular `@defer` lowering.

The remaining question is whether AbsoluteJS can build a better Angular
streaming implementation without depending on fragile private APIs, or whether a
proper solution must be upstreamed to Angular.

## Investigation plan

### 1. Prove the Angular engine's current behavior

Create a small local fixture outside AbsoluteJS first, using plain Angular 21
SSR:

- A shell component with immediately visible text.
- A routed child with a slow resolver.
- A component that waits on a pending task.
- A large `@defer` block with server rendering / incremental hydration enabled.

Run it through:

- `renderApplication`
- `AngularAppEngine.handle()`
- `AngularNodeAppEngine.handle()` if needed

Measure:

- Time until `handle()` resolves.
- Whether `response.body.getReader().read()` yields before the slow work
  completes.
- Number and timing of chunks from the response body.
- Whether disabling critical CSS changes chunk timing.

Expected result: no meaningful HTML chunk before Angular stability / full
render completes.

### 2. Inspect Angular internals for real extension points

Review these Angular package files in the installed package and, if needed, the
Angular repo source:

- `node_modules/@angular/ssr/fesm2022/ssr.mjs`
- `node_modules/@angular/platform-server/fesm2022/platform-server.mjs`
- `node_modules/@angular/platform-server/fesm2022/_server-chunk.mjs`
- Type definitions under:
    - `node_modules/@angular/ssr/types`
    - `node_modules/@angular/platform-server/types`

Questions:

- Is there any internal rendering phase before `_renderInternal` that can safely
  serialize a shell?
- Does Angular maintain enough DOM state to serialize a partial document before
  `ApplicationRef.whenStable()`?
- Can `BEFORE_APP_SERIALIZED` be used for controlled slot extraction, or does it
  only run after stability?
- Does `ɵrenderInternal` always require a stable app, or can it serialize an
  intermediate DOM safely?
- Does Angular's server platform have a hook around deferred block state that
  could be made public?

### 3. Prototype a private-API experiment only as a spike

If step 2 finds a plausible path, build a spike behind a local test file only.
Do not ship it.

Possible experiments:

- Call internal `ɵrenderInternal` before `whenStable()` to see if it can emit a
  shell safely.
- Bootstrap Angular, manually serialize the initial DOM, then wait for router /
  pending tasks and compare the final DOM.
- Subscribe to router and application stability events to identify when the
  route shell exists versus when async resolvers finish.
- Test whether a partial DOM can hydrate without mismatch after later
  server-patched HTML.

Abort criteria:

- Requires patching Angular private symbols in production code.
- Produces hydration markers that Angular cannot reconcile.
- Requires serializing arbitrary intermediate DOM states that Angular does not
  consider stable.
- Breaks transfer state, incremental hydration markers, router redirects, or
  request-scoped `RESPONSE_INIT`.

### 4. Evaluate an AbsoluteJS-owned progressive model

If native Angular progressive rendering is not viable, improve the existing
AbsoluteJS model instead:

- Make Angular `@defer` lowering more complete and Angular-native.
- Add docs for `@defer` streaming authoring patterns.
- Add tests that prove out-of-order timing, hydration safety, and fallback
  behavior.
- Support nested or route-level streaming slots if missing.
- Ensure stream patches are delayed until Angular hydration can consume them
  safely.
- Expose useful diagnostics when a user uses `@defer` but does not enable
  streaming collection.

This path is practical because AbsoluteJS already controls the slot transport.

### 5. Identify potential upstream PR shape

If the investigation shows the missing piece belongs in Angular, possible
upstream proposals:

1. Public `renderApplicationToReadableStream(...)`

    - React-like API.
    - Hardest proposal because Angular must define progressive stability,
      hydration markers, transfer state, redirects, and errors.

2. Public `renderApplicationParts(...)`

    - Similar to the idea in Angular issue #67785.
    - Could return `{ head, body, state }` or an app fragment.
    - More realistic for islands / meta-frameworks.

3. Public SSR lifecycle hooks around render phases

    - For example, hooks when app shell is bootstrapped, route recognized,
      app stable, before serialization, after serialization.
    - Might let frameworks integrate without asking Angular to own full
      progressive streaming immediately.

4. Public deferred-block SSR hooks
    - Let meta-frameworks observe or control server rendering of `@defer`
      boundaries.
    - Most aligned with Angular's current incremental hydration direction.

Any PR should start as an Angular issue or discussion with a minimal prototype
and measured user value. A direct code PR without API design agreement is likely
too risky.

## AbsoluteJS decision gates

Proceed to implementation only if one of these is true:

- Angular exposes a public progressive render API.
- A private spike proves a small, stable, public-like abstraction can be
  proposed upstream.
- The implementation can live entirely in AbsoluteJS's owned slot/defer
  transform layer without depending on Angular private APIs.

Do not proceed if the implementation requires production use of Angular `ɵ`
private APIs or assumptions about internal hydration marker layout.
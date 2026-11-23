# Render tracing

Spans for the phases of serving a page, on a tracer you supply.

```ts
import { registerTracer } from '@absolutejs/absolute';
import { tracerOrNoop } from '@absolutejs/telemetry';

registerTracer(tracerOrNoop(provider, 'app'));
```

Nothing timed a render at request time before this. `@elysia/server-timing`
is mounted in dev only and times Elysia's lifecycle hooks rather than the
render; `ABSOLUTE_BUILD_TRACE` times the build. So "which page is slow in
production, and in which phase" had no answer — which is the question a
trace exists to answer.

## No dependency, and no cost when unused

The framework takes **no dependency** on `@absolutejs/telemetry` or
`@opentelemetry/api`. `registerTracer` accepts anything with
OpenTelemetry's `startActiveSpan`, because the tracer type here is a
structural subset of both — so `tracerOrNoop(provider, 'app')` from the
package you already have, or a tracer straight from `@opentelemetry/api`,
both fit. A test pins that compatibility with a copy of the published
signatures, so a change to this framework's type that a real tracer could
not satisfy fails to compile.

With no tracer registered, `withRenderSpan` calls straight through. Measured
on a static HTML page, 2000 renders: **0.053ms per render either way** —
the instrumentation is not distinguishable from the render it wraps. What a
real tracer costs is the tracer's business, not this.

## The spans

| | |
| --- | --- |
| `render.page` | A page render, from the handler's entry to its response |
| `render.response` | The ETag hash and compression, inside the page span |

`render.response` is separate because it is work *after* the render that a
render-only trace would attribute to nothing: every framework's HTML
funnels through one chokepoint, so one span covers all of them.

A real trace of a static page:

```
render.page      1.49ms  { phase: page, framework: html, page: HTMLExample, route: /pages/:name }
  render.response 0.27ms  { phase: response, route: /pages/:name }
```

## Attributes

| | |
| --- | --- |
| `abs.render.framework` | `react`, `svelte`, `vue`, `angular`, `html`, `htmx` |
| `abs.render.page` | The page, as the manifest names it |
| `abs.render.phase` | `page`, `response`, `island`, `hole` |
| `abs.render.route` | The matched route **pattern**, e.g. `/blog/:slug` |

`route` is the pattern, not the URL: a dynamic route renders many pages, and
`/blog/:slug` is what a dashboard groups by while `/blog/hello` would be one
row per post.

### Where these names belong

`@absolutejs/telemetry` pins `ABS_ATTRS` precisely so one query resolves
spans from sync, queue and runtime together, and that is the right home for
these. It has no render attributes today, so they are defined here — in one
file, in that package's style, as `ABS_RENDER_ATTRS` — **to be folded into
it.** Two things make that cheap rather than a fork: nothing else emits
spans about rendering a page, so there is nothing for them to collide with;
and no existing `ABS_ATTRS` name fits a render, so none is reused or
shadowed here. The shared dimensions it pins — tenant, shard id — are facts
this framework does not know, and an app that wants them on these spans
sets them on its own root span.

## Failures

A render that throws records the exception on its span, sets the span's
status to error, and **re-throws**. The span says the render failed; the
caller's own error handling — which renders `error.html` and calls the
[error reporter](ERROR_REPORTING.md) — is unchanged. Swallowing it here
would turn a failed page into a blank one.

The static HTML and HTMX handlers are the exception, and deliberately: they
catch their own failure and serve the error convention, so their span
completes successfully. The visitor got a page; the failure is carried by
the error reporter, which is the thing that has somewhere to send it.

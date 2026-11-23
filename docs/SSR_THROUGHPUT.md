# SSR throughput per framework

What each framework's server render costs, where the time goes, and which
parts of it AbsoluteJS can do anything about.

Written because `absolute bench` produced the project's first
per-framework numbers and Angular stood out by roughly 8x. That needed
either a fix or an explanation, and it turned out to be an explanation.

## The numbers

`absolute bench` against the example app, concurrency 8, production mode,
on an Apple-silicon laptop. These are **relative** figures for comparing
frameworks and releases on one machine, not records.

| framework | req/s  | p50    | p99   |
| --------- | ------ | ------ | ----- |
| svelte    | 35,713 | 0.2 ms | 0.8 ms |
| vue       | 34,731 | 0.2 ms | 0.6 ms |
| html      | 28,865 | 0.2 ms | 1.0 ms |
| htmx      | 26,513 | 0.2 ms | 1.5 ms |
| react     | 17,650 | 0.4 ms | 1.5 ms |
| angular   | 4,371  | 1.5 ms | 8.7 ms |

Throughput here is just concurrency over latency: `8 / p50` predicts every
row to within 0.66–0.89, so there is no separate throughput mystery to
explain. Angular's standing is its per-request latency.

## Angular: where the 1.5 ms goes

Measured with Angular's own API and **no AbsoluteJS code** — a trivial
standalone component through `bootstrapApplication` +
`renderApplication`, 400 renders after 50 warmup renders:

```
bare Angular render: mean 1.259 ms  p50 1.240 ms  p99 1.606 ms
```

So the framework's 1.5 ms p50 sits about 0.24 ms above Angular's own
floor, and that 0.24 ms covers HTTP, routing, the ETag hash, cookies and
response compression. **There is essentially nothing in the Angular
wrapper to reclaim.**

### Almost all of it is fixed setup

Scaling the template while holding everything else constant:

| template   | mean     | output   |
| ---------- | -------- | -------- |
| 0 nodes    | 1.290 ms | 134 B    |
| 10 nodes   | 1.302 ms | 264 B    |
| 200 nodes  | 1.339 ms | 2,734 B  |
| 2000 nodes | 2.155 ms | 26,134 B |

Rendering costs about **0.43 ms per 1000 DOM nodes**. For a realistic
200-node page, **96% of the time is fixed per-request cost** — creating
the application, its injector and the platform — not rendering the page.

That ceiling is structural. Angular's SSR entry point builds an
application per request by design, and `renderApplication` is Angular's
own API, so anything built on it pays the same floor. The 8x gap against
Svelte is Angular's SSR model rather than anything specific to this
framework.

### The one provider that costs real time

| providers                   | mean     |
| --------------------------- | -------- |
| server + zoneless only      | 1.285 ms |
| `+ provideRouter` (10 routes) | 1.469 ms |
| `+ 40 value providers`      | 1.469 ms |

`provideRouter` costs **0.184 ms, about 14% of the floor**. Forty
ordinary DI tokens cost nothing measurable, so provider count is not the
issue — the router specifically is.

AbsoluteJS already injects `provideRouter` only into pages that export
`routes` (`compileAngular.ts`, guarded on `hasRoutes`), so a page without
routes does not pay it. That is worth keeping: making the injection
unconditional would remove a branch and silently cost every Angular page
14%. `tests/unit/angular/routerInjectionCost.test.ts` fails if that
happens.

## Reproducing

```bash
absolute bench --config <your config>   # per-framework throughput
absolute bench --save                   # record a baseline
absolute bench --check                  # fail CI on a regression
```

`bench` needs `bench.pages` in the config, because only your server knows
which path renders which framework. See the README's Benchmarks section.

The bare-Angular measurements above are not part of `bench`; they were
one-off probes against `getAngularDeps()`. Note that a probe like that
has to run **inside the repository** — a script under the OS temp root
resolves its own `@angular/*` from Bun's install cache, and a second
Angular instance has no compiler facade.

## What is still open

- **Streaming pages are not compressed.** Compressing through the ETag
  path buffers the body, which forfeits the fast first byte that is the
  point of streaming. Covering them needs a streaming compressor, and
  `CompressionStream` offers gzip but not brotli.
- **Whether Angular's fixed cost can be avoided at all.** It would mean
  not calling `bootstrapApplication` per request, which Angular's SSR API
  does not offer and which risks leaking state between requests. Nothing
  here suggests a safe way to do it; it is recorded as unexamined rather
  than impossible.

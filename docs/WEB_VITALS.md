# Web vitals

AbsoluteJS can report Core Web Vitals from real visits: LCP, INP, CLS, FCP and
TTFB. It's off until you turn it on:

```ts
// absolute.config.ts
export default defineConfig({
	reactDirectory: 'src/frontend/react',
	vitals: { sampleRate: 0.25 }
});
```

| Option | Default | |
| --- | --- | --- |
| `endpoint` | `/__absolute/vitals` | A path is served by the built-in route; a full URL posts elsewhere |
| `sampleRate` | `1` | Share of page loads that report, from 0 to 1 |
| `dev` | `false` | Report from `absolute dev` too |
| `summary` | on in dev, off in production | Aggregate the reports and serve them as JSON — see [The summary endpoint](#the-summary-endpoint) |

## In the browser

A production build bundles a small reporter (the `web-vitals` library plus a
sender) to `/__absolute/vitals/reporter.js` and loads it on every page:

- every framework's client bundle imports it;
- static HTML and HTMX pages get a `<script type="module">` tag.

Each page load decides once whether it reports, using `sampleRate`. A page
that reports collects every metric with its route (the path the page loaded
at) and navigation type. It sends them as one batch when the page is hidden
or closed, with `navigator.sendBeacon`, falling back to `fetch` with
`keepalive`.

With `vitals` unset nothing is built or injected. Dev injects nothing unless
`dev: true`. Pages with `client: 'none'` ship no client bundle, so they don't
report.

The reporter works with pre-rendered pages, since the reporter is part of
the page. It also works with `secureHeaders()`: it's loaded by scripts that
carry the nonce, and it only sends to the same origin.

## On the server

With `endpoint` set to a path (the default), `prepare()` serves
`POST /__absolute/vitals`. It validates each batch with a TypeBox schema
(`vitalsBatchSchema`) and answers `204`. To send every metric to your own
store, register a handler:

```ts
import { onVital } from '@absolutejs/absolute';

onVital((report, request) => {
	// report: { name: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB', value, rating?,
	//           delta?, id, navigationType?, route }
	metrics.record(`web_vitals_${report.name}`, report.value, { route: report.route });
});
```

`onVital` returns a function that removes the handler. A handler that throws
is logged and doesn't affect the response or the other handlers.

To send the batches somewhere else, set `endpoint` to a full URL. The
browser then posts the same JSON there, and the built-in route isn't
mounted.

## The summary endpoint

`onVital` is the complete answer for a real metrics backend, but it needs
one. Without a handler the reports used to be validated and dropped, so
turning `vitals` on measured every page load and kept nothing. The summary
endpoint is the answer with nothing to set up:

```
GET /__absolute/vitals/summary
```

```json
{
  "routes": [
    {
      "route": "/pricing",
      "metrics": {
        "LCP": { "count": 418, "p75": 2180, "rating": "good",
                 "good": 361, "needsImprovement": 44, "poor": 13 },
        "CLS": { "count": 418, "p75": 0.04, "rating": "good",
                 "good": 402, "needsImprovement": 11, "poor": 5 }
      }
    }
  ],
  "sampleCount": 1044,
  "since": "2026-11-23T09:12:40.118Z",
  "truncated": false
}
```

| Option | Default | |
| --- | --- | --- |
| `path` | `/__absolute/vitals/summary` | Where it's served |
| `maxRoutes` | `200` | Most routes held at once |

`p75` is the 75th percentile, which is the statistic Core Web Vitals is
assessed at — a mean would hide the slow tail the standard is about.
`rating` is the band that `p75` falls in, so it is the assessment for that
route and metric. The band counts are exact; `p75` is estimated from a fixed
histogram, so it is accurate to the width of the bucket it lands in, and a
value past the last bucket is reported as that bucket's boundary rather than
a number the histogram can't support.

The bands come from the value against the published thresholds, not from the
`rating` the browser sent — a client can send any rating it likes.

### It's on in dev and off in production

This is the one place the two modes differ, and it's deliberate.

In dev you turned collection on to look at the numbers, so they're there.
(Dev needs `vitals.dev` for any reporting at all.)

In production the endpoint is an unauthenticated read of every route that
reported and how slow each one is — a map of your app plus its weakest
pages. Publishing that is a choice:

```ts
vitals: { summary: true }                              // default path
vitals: { summary: { path: '/internal/vitals' } }      // somewhere else
vitals: { summary: false }                             // off in dev too
```

Mounting it at your own path lets you put it behind whatever your app uses
for auth, or on a port your proxy doesn't expose. If you'd rather expose
nothing, leave it off and use `onVital` — it feeds a metrics backend without
serving anything.

### What it is not

**Per process, in memory, since this process started.** Nothing is
persisted and nothing is shared between instances, so two servers behind a
load balancer each report their own share of the traffic, and a restart
starts over. `since` says when the window began.

**Bounded, and it will say when it had to be.** The route is a
client-supplied `location.pathname`, so the store is capped and the
longest-idle route is evicted — otherwise a single client posting novel
paths could exhaust memory. Paths carrying ids (`/users/1`, `/users/2`) are
distinct routes here and will push the cap on their own. `truncated` turns
true once anything has been evicted, so a partial listing is never
presented as a complete one; `sampleCount` still counts every sample taken
in, including from routes no longer listed. Raise `maxRoutes`, or use
`onVital` to aggregate by your own route patterns.

Rate limiting gives the summary a rule of its own (600/min per client by
default) rather than letting it share the batch endpoint's — see
[Rate limiting](./RATE_LIMITING.md).

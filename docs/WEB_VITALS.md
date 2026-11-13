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
(`vitalsBatchSchema`), answers `204`, and stores nothing. To keep the
metrics, register a handler:

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

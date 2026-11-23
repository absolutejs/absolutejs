# Request logging

One line per request, with an id that ties it to the response the client
got.

```ts
export default defineConfig({
	logging: { requests: 'json' }
});
```

Off by default. Writing to a project's stdout uninvited is not the
framework's call, and log volume is a decision for whoever runs the thing.

```json
{"at":"2026-11-23T05:46:39.099Z","durationMs":1.9,"level":"info","method":"GET","msg":"request","path":"/react","requestId":"30ca111e-5434-4472-90a6-d36c530b07e8","size":2670,"status":200}
```

`requests: 'text'` instead gives one scannable line:

```
2026-11-23T05:46:39.099Z GET /react 200 1.9ms req=30ca111e-5434-4472-90a6-d36c530b07e8
```

## Options

| | |
| --- | --- |
| `requests` | `'json'` (also `true`), `'text'`, or `false`/absent for nothing |
| `echoRequestId` | Send the id back as `x-request-id`. Default `true` |
| `requestIdHeader` | Inbound header to adopt an id from. Default `x-request-id` |
| `flushEachLine` | Write each line as it happens instead of batching. Default `false` |

## The request id

A proxy usually assigns one and forwards it, so an inbound id is adopted
and only a request without one gets a new UUID. That is what makes a trace
span the hops instead of restarting here. The id is also echoed on the
response — including on a 404 and on a 500, because it is set on the way
in rather than by a handler — so a user reporting a problem can quote the
same string an operator greps for.

In code, `getCurrentRequestId()` from `@absolutejs/absolute` returns the
current request's id anywhere inside the request, and computes it on first
use: a project that never asks never pays for one.

### An inbound id is validated, and replaced rather than escaped

The id is client-controlled text that lands in a log line, so it is
adopted only when it already looks like an id: letters, digits, and
`. _ - : ; = @`, up to 96 characters. Anything else is replaced with a
fresh UUID — not escaped and kept, because an id that no longer matches
what the proxy recorded correlates with nothing, and not dropped, because
a line with no id is as hard to trace as no line.

What that is **not** defending against, measured rather than assumed:
newline forgery cannot reach a handler. `new Request()` refuses CR, LF and
NUL in a header value, and over a real socket the HTTP parser ends the
value at the CRLF — sending `x-request-id: a"}<CRLF>X-Injected: yes`
arrives as the value `a"}` plus a separate header. Nobody needs to add
newline escaping here believing it closes a hole.

What does arrive intact, and is what the validation is for: ANSI escapes
(which rewrite a terminal watching the text format), quotes, spaces and
tabs (which make a text line ambiguous), and 10 KB of padding (a client
choosing how many bytes per request this process writes to disk).

AWS X-Ray and Google Cloud trace headers pass as-is, which is why `=` and
`;` are allowed:

```ts
logging: { requests: 'json', requestIdHeader: 'x-amzn-trace-id' }
```

## What it costs

An access log is a write per request, and that write is the expense — not
the formatting (0.18µs) and not the id (0.03µs). Measured on a bare Elysia
route serving 134,480 req/s on an Apple-silicon laptop:

| | per request |
| --- | --- |
| nothing emitted | 59.5µs |
| `console.log` per line | 75.3µs |
| `process.stdout.write` per line | 74.2µs |
| batched, 256 lines or 50ms | 64.2µs |

So lines are batched by default. On the example app's React page the
difference is the whole feature's cost: **17,801 req/s without logging,
15,725 with a write per line (−12%), 17,355 batched (−2.5%)**, three runs
each, median, stdout to a file.

What batching risks is the tail. The buffer is flushed when it reaches 256
lines, after 50ms, and on every normal exit — but a process killed by a
signal loses whatever is still held, which are exactly the lines someone
investigating that death wants. `flushEachLine: true` trades the 12% back
for losing nothing.

Enabling an access log deliberately does **not** install SIGINT or SIGTERM
handlers: a listener on those suppresses the default terminate, so the
handler would have to exit the process itself, and turning on a log would
preempt whatever graceful shutdown the app has.

## A note on where this had to be wired

`logging` is read by a plugin the production server mounts, and a
production server does not import `absolute.config.ts` — it reads
`absolute-runtime.json`, which the build writes from an explicit allowlist
of keys (`src/core/productionRuntime.ts`). A key missing from that list is
silently ignored in production while working in dev. That is how this
feature first failed, and checking the list turned up `basePath` and
`basePathShared` in the same state: a configured base path produced no
import map and no prefixed module URLs in production, while the same build
with `ABSOLUTE_BASE_PATH` in the environment worked. Both are in the list
now, with tests.

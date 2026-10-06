# HTTP/2 Dev Server — Status & Roadmap

## Goal

Serve dev module fetches over one multiplexed HTTP/2 connection when HTTPS is
on, removing HTTP/1.1's 6-connections-per-origin bottleneck on import-heavy
pages.

## Status (re-checked 2026-10-05 on Bun 1.4.2)

**Unblocked.** Bun 1.4.1 added HTTP/2 to `Bun.serve()`
([oven-sh/bun#40137](https://github.com/oven-sh/bun/issues/40137), which
closed our blocker [#14672](https://github.com/oven-sh/bun/issues/14672)).
It is opt-in:

```ts
Bun.serve({ tls: { cert, key }, http2: true, fetch, websocket });
```

With TLS, a client that offers `h2` through ALPN gets HTTP/2 and everyone else
gets HTTP/1.1, on the same port. `http1: false` refuses HTTP/1.x entirely.

**WebSockets do not need HTTP/2.** Bun does not yet carry WebSockets over
HTTP/2 (RFC 8441, now tracked as
[oven-sh/bun#44061](https://github.com/oven-sh/bun/issues/44061)), and it no
longer has to for HMR. A browser only uses Extended CONNECT when the server
sends `SETTINGS_ENABLE_CONNECT_PROTOCOL`; otherwise it opens a separate
HTTP/1.1 connection for the WebSocket, and that connection negotiates
`http/1.1` on the same TLS port. Our earlier blocker for that path,
[oven-sh/bun#28581](https://github.com/oven-sh/bun/pull/28581), was closed
unmerged and is no longer needed.

Verified on Bun 1.4.2, both with `Bun.serve` directly and through Elysia
(`app.listen({ tls, http2: true })`) on 2.0.0-beta.6 and 2.0.0-beta.21:

- a `node:http2` client negotiated `h2` and ran 10–20 module requests
  multiplexed on **one** connection
- a WebSocket to `/hmr` on the same port connected and echoed

**Shipped in 0.20.0-beta.131.** With `dev: { https: true }`,
`src/plugins/networking.ts` passes `http2: true` alongside `tls`. The dead
`globalThis.__http2Config` bridge plumbing is gone.
`tests/integration/hmr/lifecycle/https-http2-browser.test.ts` loads the HTTPS
dev server in Chromium and asserts both halves: every page script arrives
over `h2`, and the `/hmr` WebSocket receives frames over `wss://`. The test
fails if `http2: true` is removed.

Next: measure the gain on a remote dev host (a Studio workspace), where the
six-connection limit actually bites.

## HTTP/3 is tracked separately

See [docs/HTTP3_STATUS.md](./HTTP3_STATUS.md). HTTP/2 was the transformative
step; HTTP/3 is incremental and largely invisible on localhost.

## Outbound HTTP/2 fetch

`fetch(url, { protocol: "http2" })` has worked per request since Bun 1.3.14.
It suits outbound fan-out to one origin: remote image fetches in
`src/plugins/imageOptimizer.ts`, AI provider calls, user code. Independent of
the dev server.

## References

- Bun 1.4.1 release notes: <https://bun.com/blog/bun-v1.4.1>
- RFC 8441 (WebSockets over HTTP/2): <https://www.rfc-editor.org/rfc/rfc8441>

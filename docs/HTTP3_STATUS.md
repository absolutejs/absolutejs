# HTTP/3 Dev Server — Status & Roadmap

> Separate from [docs/HTTP2_STATUS.md](./HTTP2_STATUS.md) on purpose. h3 is not
> a prerequisite for shipping h2 in AbsoluteJS, and gating h2 work on h3
> readiness would be a mistake. This doc tracks the h3 path independently so
> the h2 effort can move at its own pace.

## Goal

Serve dev module fetches and (eventually) production traffic over HTTP/3 +
QUIC for per-stream head-of-line elimination, faster handshake, and network
migration. Combined with WS-over-h3, HMR would run end-to-end on a single
multiplexed QUIC connection.

## What Bun 1.3.14 added (2026-05-13)

```js
Bun.serve({
  port: 443,
  tls: { cert, key },
  http3: true,                 // listen on UDP/443 for HTTP/3
  http1: false,                // optional — h3-only
  fetch(req) { return new Response("hi"); },
});
```

- Binds TCP for HTTP/1.1+2 and UDP for HTTP/3 on the same port.
- HTTP/1.1 and HTTP/2 responses automatically include
  `Alt-Svc: h3=":<port>"; ma=86400`, so capable clients upgrade transparently.
- Bench (loopback, single process, Linux x64): ~509k req/s static, ~283k
  req/s dynamic handler — vs ~189k / ~142k on HTTPS/1.1.
- Uses lsquic v4.6.2.
- Client side: `fetch(url, { protocol: "http3" })` per-request, plus
  `--experimental-http3-fetch` flag.

## What 1.3.14 explicitly does NOT support

Direct quotes from the release notes:

- **WebSocket over HTTP/3** — `server.upgrade()` returns `false`. *This is the
  critical gap for HMR.*
- **0-RTT** — disabled.
- **Unix socket addresses with H3 listener** — unsupported.
- **Trailers, `Expect: 100-continue`** — unsupported on h3.

The h3 server is also marked *"highly experimental; production deployment not
recommended"* and *"likely has bugs."*

## Is h3 worth it for HMR? (vs h2)

**Small additional win, not another big jump.** The transformative gain is
h1.1 → h2 (kills the 6-connection bottleneck, enables multiplexed module
fetches). h2 → h3 is incremental:

| Property | h2 vs h1.1 | h3 vs h2 |
| --- | --- | --- |
| Multiplexing | New (huge win) | Same (no change) |
| Head-of-line blocking | TCP-level — one stalled packet stalls all streams | Per-stream (QUIC) — no cross-stream stall |
| Header compression | HPACK (new) | QPACK (lateral change) |
| Connection setup | TCP + TLS handshake | UDP + TLS 1.3 in one RTT; 0-RTT possible (Bun has 0-RTT disabled) |
| Network migration | None | Connection survives IP change |

**On localhost**, h3's advantages largely evaporate — no packet loss → no HoL
difference, no migration events → no migration win, TCP slow-start irrelevant.
**On remote dev environments** (Codespaces, dev container behind a network
hop, lossy wifi) the per-stream HoL elimination is real but incremental.

## Blockers before AbsoluteJS can adopt h3 for HMR

### 1. WS upgrade on Bun.serve h3 listener
**Status:** Missing in 1.3.14. **Tracking:** none filed yet — search
`oven-sh/bun` issues for "WebSocket http3 upgrade" before opening.

`server.upgrade()` returns `false` on the h3 path. Without WS-over-h3 there's
no single-multiplexed-connection HMR — we'd need a parallel h1.1/h2 listener
just for the WS, which defeats the whole point.

### 2. RFC 9220 (WebSockets over HTTP/3) implementation
**Status:** Not implemented in Bun. **Tracking:** no issue filed as of
2026-05-13.

RFC 9220 specifies Extended CONNECT over HTTP/3 — the h3 equivalent of RFC
8441 (h2's Extended CONNECT). Browsers (Chrome, Firefox) support it. Bun needs
to wire it through lsquic and surface it on the `server.upgrade()` path.

### 3. Production-readiness signal from Bun
**Status:** Currently "highly experimental, likely has bugs."

We shouldn't ship `dev.http3: true` to users while the upstream marks it
unsuitable for production — even for a dev-only feature, "likely has bugs" is
a hard "no" for the framework's default path.

## Plan when h3 unblocks

1. **`src/plugins/networking.ts`** — accept `dev.http3: true` config and pass
   through to `Bun.serve({ http3: true })`. Keep h1.1 fallback enabled by
   default (`http1: true`) so non-h3 clients still work.
2. **`src/plugins/hmr.ts`** — same `__http2Config`-style gate to skip Elysia
   `.ws('/hmr')` in h3 mode, using RFC 9220 Extended CONNECT instead.
3. **TLS** — h3 requires TLS unconditionally (no h3c equivalent). Our existing
   `dev: { https: true }` + `devCert.ts` mkcert path satisfies this.
4. **Document the localhost-vs-remote tradeoff** — h3 buys little on loopback;
   pitch it for remote dev / production rather than as a blanket default.

## Not a blocker — parallel side benefits in 1.3.14

`fetch(url, { protocol: "http3" })` for outbound calls works today (per-request,
no flag needed beyond `--experimental-http3-fetch` for the env-flag form).
Already covered in [docs/HTTP2_STATUS.md](./HTTP2_STATUS.md#side-opportunity-unlocked-by-1314--outbound-h2-fetch);
h3 is a superset of the same opportunity for outbound fetches once it
stabilizes.

## References

- Bun 1.3.14 release notes: <https://bun.com/blog/bun-v1.3.14>
- RFC 9114 (HTTP/3): <https://www.rfc-editor.org/rfc/rfc9114>
- RFC 9220 (WebSockets over HTTP/3): <https://www.rfc-editor.org/rfc/rfc9220>
- lsquic: <https://github.com/litespeedtech/lsquic>

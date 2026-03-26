# HTTP/2 Dev Server — Status & Roadmap

## Goal
Serve dev module fetches (/@src/, vendor, etc.) over HTTP/2 multiplexed connections
to eliminate the HTTP/1.1 6-connection bottleneck on import-heavy pages.

## What's Built & Working

### HTTPS / TLS (shipping now)
- `dev: { https: true }` config option
- `src/dev/devCert.ts` — mkcert + self-signed cert generation
- `src/plugins/networking.ts` — Bun.serve with TLS when HTTPS enabled
- `src/cli/scripts/dev.ts` — passes `ABSOLUTE_HTTPS=true` to server process

### HTTP/2 Plumbing (ready, waiting on Bun)
- `src/core/prepare.ts` — exposes `globalThis.__http2Config` when `dev.https` is enabled
- `src/plugins/hmr.ts` — skips Elysia `.ws('/hmr')` when `__http2Config` is set (h2 mode handles WS differently)
- `types/globals.d.ts` — `__http2Config` type declaration
- `types/build.ts` — `dev.https` config type

### RFC 8441 WebSocket over HTTP/2 (tested, not shipping)
We built and tested WebSocket over HTTP/2 via Extended CONNECT (RFC 8441).
This runs WebSocket as a multiplexed h2 stream — no separate HTTP/1.1 connection.
- Browser sends `:method: CONNECT` + `:protocol: websocket` on an h2 stream
- Server responds `:status: 200`, stream becomes bidirectional WebSocket
- Minimal WebSocket frame parser/writer handles text messages for HMR
- Confirmed working with Chrome via Playwright

### Bun Patch: enableConnectProtocol (PR-ready)
**Repo:** `~/alex/bun-http2-patch` (branch: `feat/http2-enable-connect-protocol`)

**The bug:** `session.settings({ enableConnectProtocol: true })` is validated in JS
and the Zig struct has the field, but `loadSettingsFromJSValue()` in
`src/bun.js/api/bun/h2_frame_parser.zig` silently ignores it. The setting is never
sent in the SETTINGS frame, so browsers never try Extended CONNECT.

**The fix:** 7 lines in `loadSettingsFromJSValue()` following the exact `enablePush` pattern.

**Status:** Built, tested, confirmed working. Ready for PR to oven-sh/bun.

## What's Blocking

### Bun Issue #14672 — HTTP/2 for Bun.serve()
**This is the critical blocker.** Currently `Bun.serve()` only speaks HTTP/1.1.
Our JS-level bridge (`node:http2` → `app.fetch()` → `arrayBuffer()` → `stream.end()`)
works but adds per-request overhead that negates the multiplexing gain at scale:

| Metric | HTTP/1.1 (Bun.serve) | HTTP/2 (JS bridge) |
|---|---|---|
| Resource fetch sum (250 resources) | 21,626ms | **4,310ms** (5x better) |
| Page load wall time | **~2,800ms** | ~22,000ms (8x worse) |

The h2 multiplexing works (5x faster aggregate fetch), but the JS bridge overhead
per-request makes overall load 8x slower than Bun.serve's native Zig path.

**Track:** https://github.com/oven-sh/bun/issues/14672

### Bun Issue #26721 — allowHTTP1 broken on node:http2
`allowHTTP1: true` doesn't advertise `http/1.1` in ALPN, so HTTP/1.1 fallback
for WebSocket upgrade never works. Our RFC 8441 approach bypasses this entirely,
but it's relevant if someone wants the traditional `ws` upgrade path.

**Track:** https://github.com/oven-sh/bun/issues/26721

### Bun Quirk — listen(port, hostname) breaks ALPN
Passing a hostname to `server.listen(port, hostname)` on a `node:http2` server
causes ALPN negotiation to fail. `server.listen(port)` works fine.
Not filed as an issue yet.

## When Bun.serve Gets HTTP/2

Once #14672 lands, the path to enable HTTP/2 is:

1. **networking.ts** — pass h2 option to `app.listen()` / `Bun.serve()` config
2. **hmr.ts** — the `__http2Config` check already skips `.ws()` in h2 mode
3. **WebSocket** — use RFC 8441 Extended CONNECT (requires enableConnectProtocol patch or Bun fixing it natively)
4. Remove the `__http2Config` bridge pattern if Bun.serve handles h2 + WS natively

## Combined Patch Build
**Repo:** `~/alex/bun-combined-patch` (both reactFastRefresh + enableConnectProtocol)
**Script:** `scripts/use-combined-bun.sh`

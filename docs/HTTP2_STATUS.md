# HTTP/2 Dev Server — Status & Roadmap

## Goal
Serve dev module fetches over HTTP/2 multiplexed connections when configured to eliminate the
HTTP/1.1 6-connection bottleneck on import-heavy pages.

## What's Built & Ready

### HTTPS / TLS (shipping)
- `dev: { https: true }` config option
- `src/dev/devCert.ts` — mkcert + self-signed cert generation
- `src/plugins/networking.ts` — Bun.serve with TLS when HTTPS enabled
- `src/cli/scripts/dev.ts` — passes `ABSOLUTE_HTTPS=true` to server process

### HTTP/2 Plumbing (waiting on Bun)
- `src/core/prepare.ts` — exposes `globalThis.__http2Config` when `dev.https` is enabled
- `src/plugins/hmr.ts` — skips Elysia `.ws('/hmr')` when `__http2Config` is set (h2 mode uses RFC 8441 WebSocket instead)
- `types/globals.d.ts` — `__http2Config` type declaration
- `types/build.ts` — `dev.https` config type

## What's Blocking

### Bun Issue #14672 — HTTP/2 for Bun.serve()
**Critical blocker.** `Bun.serve()` only speaks HTTP/1.1. Using `node:http2`
as a JS-level bridge works but the per-request overhead through `app.fetch()`
negates the multiplexing gain at scale. HTTP/2 needs to happen at the native
Bun.serve level.

**Track:** https://github.com/oven-sh/bun/issues/14672

**Status as of Bun 1.3.14 (2026-05-13):** Still OPEN, last touched 2026-02-17.
Bun 1.3.14 added HTTP/3 to `Bun.serve` but **skipped HTTP/2 server** — and the
HTTP/3 server doesn't support WebSocket upgrade (see h3 section below), so the
release doesn't unblock us. The team appears to be prioritizing h3 over h2 for
the server side.

### Bun PR #28581 — enableConnectProtocol SETTINGS
`session.settings({ enableConnectProtocol: true })` is silently ignored —
the setting never reaches the SETTINGS frame. Browsers require
`SETTINGS_ENABLE_CONNECT_PROTOCOL=1` before using RFC 8441 Extended CONNECT
for WebSocket over HTTP/2.

**Track:** https://github.com/oven-sh/bun/pull/28581

**Status as of Bun 1.3.14 (2026-05-13):** Still OPEN, not merged, last touched
2026-03-26. This is the actual unblocker for WS-over-h2 in the `node:http2`
bridge path — without it the browser refuses Extended CONNECT.

## When Bun.serve Gets HTTP/2

1. **networking.ts** — pass h2 option to `app.listen()` / `Bun.serve()` config
2. **hmr.ts** — `__http2Config` check already skips `.ws()` in h2 mode
3. **WebSocket** — use RFC 8441 Extended CONNECT (requires #28581 or Bun adding it natively)
4. Remove `__http2Config` pattern if Bun.serve handles h2 + WS natively

## HTTP/3 is tracked separately

h3 is **not a prerequisite** for h2. The h1.1 → h2 jump is the transformative
win (kills the 6-connection bottleneck, enables Extended CONNECT WS); h2 → h3
is incremental and largely invisible on localhost. See
[docs/HTTP3_STATUS.md](./HTTP3_STATUS.md) for h3 tracking — including why Bun
1.3.14's new `Bun.serve({ http3: true })` doesn't unblock HMR (no WS upgrade
on the h3 listener, no RFC 9220 yet).

Plan: ship h2 first via the `node:http2.createSecureServer()` bridge once
#28581 lands. Revisit h3 as an optional add-on later — don't gate h2 on it.

## Side opportunity unlocked by 1.3.14 — outbound h2 fetch

`fetch(url, { protocol: "http2" })` is shippable today (per-request opt-in,
no flag). Useful for **outbound** AbsoluteJS calls where multiplexing matters:

- `src/plugins/imageOptimizer.ts` — remote image fetches (currently 1 fetch
  per `<Image>` request to upstream CDN; multiplexing to e.g. an image origin
  cuts handshake cost).
- AI provider adapters (in the separate `absolute-ai-example` project) — many
  parallel SSE/JSON requests to the same provider host.
- Any user code that does fan-out fetches to a single origin.

This doesn't fix the dev-server HMR story, but it's a free win for runtime
fetches. Marked "experimental" but stable enough that the per-request opt-in
form is documented in the release notes (no flag required).

## References

- Bun 1.3.14 release notes: <https://bun.com/blog/bun-v1.3.14>
- RFC 8441 (WS over HTTP/2): <https://www.rfc-editor.org/rfc/rfc8441>
- RFC 9220 (WS over HTTP/3): <https://www.rfc-editor.org/rfc/rfc9220>

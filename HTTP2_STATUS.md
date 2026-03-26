# HTTP/2 Dev Server — Status & Roadmap

## Goal
Serve dev module fetches over HTTP/2 multiplexed connections to eliminate the
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

### Bun PR #28581 — enableConnectProtocol SETTINGS
`session.settings({ enableConnectProtocol: true })` is silently ignored —
the setting never reaches the SETTINGS frame. Browsers require
`SETTINGS_ENABLE_CONNECT_PROTOCOL=1` before using RFC 8441 Extended CONNECT
for WebSocket over HTTP/2.

**Track:** https://github.com/oven-sh/bun/pull/28581

## When Bun.serve Gets HTTP/2

1. **networking.ts** — pass h2 option to `app.listen()` / `Bun.serve()` config
2. **hmr.ts** — `__http2Config` check already skips `.ws()` in h2 mode
3. **WebSocket** — use RFC 8441 Extended CONNECT (requires #28581 or Bun adding it natively)
4. Remove `__http2Config` pattern if Bun.serve handles h2 + WS natively

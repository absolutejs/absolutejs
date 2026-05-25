# Upstream Issues

Bugs and footguns in AbsoluteJS's **dependencies** (Bun, Elysia, …) that bite
AbsoluteJS apps — especially compiled (`absolute compile`) apps deployed to
strict/sandboxed hosts like DigitalOcean App Platform. We can't fix these in our
code, but we track them here with the symptom, root cause, a workaround, and the
upstream issue to watch. Remove an entry once the upstream fix ships and we've
bumped past it.

---

## 1. Elysia `status("<reason-phrase>")` emits a malformed 204 (Content-Length mismatch)

- **Dependency:** Elysia (`elysia`)
- **Status:** tracked upstream (fix PR open)
  - Issue **#1277** — "Using Cloudflare workers and returning a 204 returns a body
    which is unacceptable by Cloudflare and causes a 500" (closed):
    https://github.com/elysiajs/elysia/issues/1277
  - PR **#1833** (the fix) — "fix: empty-body status codes send body when using
    string status names" (open):
    https://github.com/elysiajs/elysia/pull/1833

**Symptom.** A handler that returns `status("No Content")` produces an HTTP 204
with `Content-Length: 10` but **zero body bytes**. Over HTTP/1.1 this is
tolerated (curl, local dev), so it passes locally — but a **strict HTTP/2 proxy
(Cloudflare, which fronts DigitalOcean App Platform) rejects the framing
mismatch and returns a fast `504`** (~0.2s, not a hang). Every bodyless-status
endpoint breaks in production: login session cookie, logout, and all
delete/archive routes.

**Root cause.** Passing the reason-phrase **name** to `status()` makes Elysia put
the string (`"No Content"`, length 10) in the response body **and** set
`Content-Length: 10`. The 204 then strips the body, leaving the now-wrong
`Content-Length`. `304 Not Modified` would have the same problem.

**Workaround.** Use the **numeric** code: `status(204)` (and `status(304)`).
Verified via Bun + Elysia serialization tests to emit a clean `Content-Length: 0`
while preserving `Set-Cookie`. `set.status = 204; return;` and
`return new Response(null, { status: 204 })` are also clean.

```ts
// ❌ malformed 204 — 504s behind Cloudflare/HTTP-2
return status("No Content");
// ✅ clean 204
return status(204);
```

**Why local never catches it.** `curl`/HTTP-1.1 tolerates a `Content-Length` vs
body-length mismatch; only HTTP/2 proxies enforce it. Test through the real
deployed edge, not just localhost.

**Detection.** From inside the container (or any HTTP/1.1 client):
`fetch(url).then(r => r.headers.get("content-length"))` on a 204 route — if it's
nonzero with an empty body, you have this bug.

---

## 2. Bun has no reliable Happy-Eyeballs / IPv4 fallback (hangs on no-IPv6-egress hosts)

- **Dependency:** Bun (`bun`)
- **Status:** open upstream
  - **#25619** — DNS resolution prefers global IPv6 → timeout (our exact case):
    https://github.com/oven-sh/bun/issues/25619
  - **#29695** — `dns.lookup(..., {hints: ADDRCONFIG})` returns IPv6 inside
    `Bun.serve` but IPv4 in a plain Bun process:
    https://github.com/oven-sh/bun/issues/29695
  - **#9658** — Implement Happy Eyeballs for sockets and fetch (closed, but
    incomplete for `node:net`/`node:https`):
    https://github.com/oven-sh/bun/issues/9658
  - **#28596** — `net.createConnection` doesn't use Happy Eyeballs → postgres.js
    / ioredis hang on dual-stack (closed):
    https://github.com/oven-sh/bun/issues/28596
  - #10731 — "2 step plan to fix most DNS-related issues in Bun" (closed):
    https://github.com/oven-sh/bun/issues/10731

**Symptom.** On a host with **no outbound IPv6 egress** (DigitalOcean App
Platform silently blackholes IPv6 — DO docs: _"App Platform apps do not support
connecting to IPv6 services… ETIMEDOUT"_), any call to a **dual-stack host** that
publishes AAAA records (e.g. every `*.googleapis.com`) **hangs ~25s × retries ≈
138s → gateway 504**. IPv4-only hosts (OpenAI, Deepgram) are unaffected, which
makes it look like "only Google is broken."

**Root cause.** Bun connects to whichever address DNS returns first
(`verbatim`/IPv6-preferred) and does **not** fall back to IPv4 — Happy Eyeballs
is missing/incomplete in `node:net` and `node:https`. Node.js has had
`autoSelectFamily` (Happy Eyeballs) **on by default since Node 20**, so the whole
Node ecosystem is immune — this only bites Bun. **Not** related to
`absolute compile`: a plain `bun run` hangs identically.

**Things that do NOT fix it** (all verified hanging under a silent IPv6
blackhole): `dns.setDefaultResultOrder("ipv4first")` (Bun ignores it for
connect), `https.globalAgent.options.lookup`, and a library's own agent option
(e.g. firebase-admin `httpAgent` — its OAuth path bypasses it).

**Workaround.** Force IPv4 at connect time with an explicit `lookup` on the
`node:https` request/agent (138s → ~190ms):

```ts
import { lookup as dnsLookup } from "node:dns";
const forceIPv4 = ((hostname, options, cb) =>
  dnsLookup(hostname, { ...options, family: 4 }, cb)) as import("node:net").LookupFunction;

https.request(url, { lookup: forceIPv4, /* … */ });
// or: new https.Agent({ lookup: forceIPv4 })  — for libraries that accept an agent
//     AND route their connections through it.
```

For our own `fetch` calls this is moot — but third-party SDKs built on
`node:https` (firebase-admin, googleapis, aws-sdk v2, ioredis, postgres.js) will
hang. Prefer libraries that use Bun's `fetch`, or inject a forced-IPv4 agent.

**Reproduce locally** (a true silent blackhole; docker's default v6 gateway
rejects too fast and hides it):

```bash
docker network create --ipv6 --subnet 2001:db8:1::/64 v6bh
docker run --rm --network v6bh --cap-add=NET_ADMIN oven/bun:latest bash -c '
  apt-get update -qq && apt-get install -y -qq iproute2 iptables >/dev/null
  ip -6 route add default dev eth0
  ip6tables -A OUTPUT -p tcp -j DROP   # silent blackhole = DO behavior
  bun -e "await fetch(\"https://oauth2.googleapis.com/\")"   # hangs
'
```

**Detection.** A request to a `*.googleapis.com` (or any AAAA-having) host hangs
~25–138s on DO but works locally; IPv4-only hosts work everywhere. Confirm with
`getent ahostsv6 <host>` (has AAAA?) and `curl -6 <host>` from the box (does v6
egress work?).

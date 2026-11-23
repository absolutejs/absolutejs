# Rate limiting

```ts
export default defineConfig({
	rateLimit: {
		limit: 300,
		rules: [
			{ limit: 10, path: '/api/upload', windowMs: 60_000 },
			{ limit: 100, path: '/api' }
		]
	}
});
```

A refused request answers `429` with `Retry-After`, plus the IETF
`RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` headers on
every response. It is refused in `onRequest`, so it never reaches a
handler — not doing the work is the point.

## What is limited, and what is not

| | |
| --- | --- |
| App routes | Only when `limit` or a `rule` says so |
| The vitals endpoint | **Limited by default** (60/minute per client) when mounted |
| The health endpoints | **Never** by a global `limit` |

**App routes are opt-in** because a framework that starts refusing a
project's traffic on its own, at a number it picked, is worse than one that
does nothing.

**The vitals endpoint is not**, because it is an unauthenticated POST sink
the framework mounts on the app's behalf: leaving it open is the
framework's omission rather than the project's choice. A real page sends
one batch per load, so 60 a minute is generous for a browser and useless as
an amplifier. An explicit rule for that path replaces the default.

**The health endpoints are held out of a global `limit`** — see below.

The longest matching prefix wins, so `/api/upload` above is stricter than
`/api` rather than masked by it.

## Never rate-limit a readiness probe

A 429 to a readiness probe is a failed probe, and a failed readiness probe
takes the process out of rotation. A limit there turns a burst of probes
into an outage: exactly the failure the limit was added to prevent, caused
by the limit.

So `/__absolute/live` and `/__absolute/ready` are exempt from a global
`limit`. A rule that names one still applies — a project that means to
limit its own probes may.

Their real problem was never request rate but cost per request: readiness
runs whatever the app registered. Measured with a check doing one 2ms
query, **500 concurrent probes produced 500 invocations in 37ms.** That is
fixed where it belongs, in [health](HEALTH.md): a report is reused for a
second and concurrent probes share one run, so the same 500 probes now cost
**one** invocation — without refusing anybody.

## What a request is counted by

The **connection address** (`server.requestIP`), not `x-forwarded-for`.

A client that chooses its own key has no limit: with the header trusted, a
fresh value per request is a fresh bucket per request and every limit here
is decoration. So `trustProxy: true` opts in, and belongs only behind a
proxy you control that sets the header.

```ts
rateLimit: { limit: 300, trustProxy: true }
```

This is the opposite default from `isHttpsRequest`, which may read its
header freely because spoofing it can only ever turn a cookie's `Secure`
flag **on**. Here spoofing would turn enforcement **off**, so the trust has
to be stated.

## The store is bounded

One bucket per key, and an attacker picks the keys — a botnet, or a spoofed
header under `trustProxy`. An unbounded map would make the limiter the
memory-exhaustion vector it was added to prevent, so at most `maxKeys`
(default 10,000) are held and the least recently seen is evicted.

Eviction order is by last request, not by first: a client still sending
traffic keeps its bucket rather than getting a fresh allowance by being
evicted.

## Per process

Two instances behind a load balancer each allow the configured rate. Shared
counting needs a shared store, which is a decision clustering (plan item
5.9) has to settle first — so this is honest rather than ideal, and the
number to configure is the per-instance one.

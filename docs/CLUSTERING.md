# Clustering

Run several server processes sharing one port, so requests use more than
one core. Off by default.

```ts
// absolute.config.ts
cluster: true              // one worker per CPU core
cluster: { workers: 4 }
```

`absolute start` then spawns that many server processes. Each binds the
same port and the kernel spreads connections across them.

## Linux only, and it says so

Clustering here rides `SO_REUSEPORT`, and what that does depends on the
kernel.

**Linux** distributes connections across every socket bound to the port.
Measured on `oven/bun:1.4.4` with a CPU-bound handler:

| workers | throughput | per-worker requests |
| --- | --- | --- |
| 1 | 3,245 req/s | — |
| 4 | **11,077 req/s** (3.4×) | 10891 / 11236 / 11253 / 11107 |

**macOS does not.** `SO_REUSEPORT` on Darwin is a handoff primitive, not a
balancer: one socket takes everything. The same probe, 4 workers:

| workers | throughput | per-worker requests |
| --- | --- | --- |
| 4 | 2,689 req/s (no gain) | 10850 / **0** / **0** / **0** |

So on anything that is not Linux, `cluster` runs a **single process** and
prints why at startup. Other platforms are excluded for want of evidence,
not because they are known to fail — only `linux` and `darwin` were
measured.

That is deliberate rather than conservative. Spawning four processes where
three will never serve a request wastes memory, but the real problem is
that it would make local behaviour differ from production in a way that
hides bugs — see below.

## Per-process state is divided between workers

This is the part to think about before turning it on. Anything the
framework keeps in memory is per worker, so with four workers each one
sees roughly a quarter of the traffic:

- **Rate limiting** counts per process. A `limit` of 100/minute becomes
  effectively 400/minute across four workers, and a single client is only
  limited by the worker its connection landed on. Plan item 5.9 is what
  shared counting is waiting for.
- **The vitals summary** (`/__absolute/vitals/summary`) reports the worker
  that answered the request, not the whole server. Its `since` and
  `sampleCount` are that worker's.
- **Health checks** run per worker, which is usually what you want: a probe
  reports the process that answered it.

None of this is new with clustering — it is already true of two instances
behind a load balancer — but clustering makes it true on one machine,
where it is easy not to expect.

**The macOS behaviour makes this worse if it were allowed**, which is why
it is not: with every connection landing on one process, a rate limit
tested locally would look exactly right and then be four times looser in
production. Running a single process locally keeps the two honest.

## Shutdown

`absolute start` signals every worker and waits for all of them. Each
drains its own in-flight requests — see
[Graceful shutdown](./GRACEFUL_SHUTDOWN.md).

## Choosing a worker count

`cluster: true` uses one worker per CPU core, which is the usual starting
point for CPU-bound rendering. If your handlers are IO-bound, fewer workers
may serve as well, since each one is already concurrent.

Each worker is a full server process with its own memory. Four workers is
roughly four times the resident memory of one, which is the trade for the
throughput above.

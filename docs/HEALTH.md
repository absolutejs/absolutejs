# Health checks

Two endpoints, on by default, with no configuration:

| | |
| --- | --- |
| `GET /__absolute/live` | Is the process running? Answers `{"status":"ok"}` without running any check |
| `GET /__absolute/ready` | Can it serve? Runs every registered check; `503 {"status":"unready"}` when any fails |

Both answer `cache-control: no-store`.

## Why not just probe a page

Because a 200 from a page means "this page rendered", and that is the wrong
question in three ways:

- **One broken page gets a healthy process killed.** A liveness probe that
  fails is a restart.
- **An app with no `/` route answers 404** and reads as dead.
- **Liveness and readiness collapse into one answer**, so a process that is
  up but cannot reach its database keeps taking traffic instead of being
  taken out of rotation.

It is also cheaper, though that is the least of it. Measured on the example
app's production build in one run: `/__absolute/live` serves 125,095 req/s
at a p50 of 0.050ms, the root page 22,164 req/s at 0.315ms.

## Readiness checks

The framework cannot know what your app needs. Register what it does:

```ts
import { registerHealthCheck } from '@absolutejs/absolute';

registerHealthCheck('database', async () => {
	await db.query('select 1');
});

registerHealthCheck('cache', () => redis.status === 'ready');
```

Return `false`, or throw, to say the dependency is unusable. Return nothing
(or `true`) when it is. Registering the same name twice replaces the first,
so a module that re-evaluates under dev HMR does not accumulate duplicates;
the call returns a function that removes the check.

**Keep each check to what the app actually needs.** A check that talks to a
dependency this process can serve without turns an unrelated outage into
this process being removed from rotation.

### What a check cannot do to the probe

- **Hang it.** Each check is raced against `timeoutMs` (default 2000) and a
  check that overruns is reported as `timed out`. Without this, the
  orchestrator's own timeout fires instead and reports a timeout rather
  than which dependency was unreachable.
- **Crash it.** A throw or a rejection is caught and becomes that check's
  `error`. An uncaught one would 500 the endpoint, which an orchestrator
  reads as unhealthy by accident, with no name attached.
- **Slow it down by adding more.** Checks run concurrently, so a probe
  costs the slowest check rather than the sum.

An app that registered no checks is ready. Answering 503 because a feature
is unused would take every default deployment out of rotation.

### A probe does not cost a check

Readiness is an unauthenticated GET that runs whatever you registered, so
without care it is an amplifier: measured with a check doing one 2ms query,
**500 concurrent probes produced 500 invocations in 37ms.**

Two things bound that. A report is reused for `cacheMs` (default 1000), and
concurrent probes share one run rather than each starting their own — the
TTL alone would not help, since requests arriving together all miss a cache
nothing has filled yet. The same 500 probes now cost **one** invocation.

An orchestrator probing every 2-5s never sees a cached answer, which is the
point: this collapses floods, not probes. Raising `cacheMs` makes a real
outage take longer to show; `cacheMs: 0` runs every check on every probe.

Registering or removing a check invalidates a cached report, because a
report describes the set of checks it ran — otherwise a process that
answers a probe before registering its database check would report `ok` for
a second on the strength of having had no checks.

Rate limiting is deliberately **not** used here: a 429 to a readiness probe
is a failed probe, and a failed probe takes the process out of rotation. See
[rate limiting](RATE_LIMITING.md).

## Options

```ts
export default defineConfig({
	health: {
		details: true,
		liveness: '/healthz',
		readiness: '/readyz',
		timeoutMs: 1000
	}
});
```

`health: false` removes both endpoints.

`details` is off by default. These endpoints are reachable by anyone who can
reach the app, and the names of your dependencies — `internal-billing-db` —
are information you may not want to publish. With it on, the body carries
each check's name, duration and error:

```json
{"checks":[{"durationMs":12.4,"error":"ECONNREFUSED 10.0.0.9:5432","name":"database","ok":false}],"status":"unready"}
```

## Probes and the access log

A readiness probe every two seconds is 43,200 log lines a day that say
nothing about anyone using the site, and they would arrive the moment
someone turned on `logging: { requests: 'json' }`. So the access log skips
`/__absolute/*` — the health endpoints, the vitals collector, the dev
request inspector. `logging: { logInternalRequests: true }` logs them when
you are debugging a probe. The id is assigned and echoed either way.

## Kubernetes

```yaml
livenessProbe:
  httpGet: { path: /__absolute/live, port: 3000 }
readinessProbe:
  httpGet: { path: /__absolute/ready, port: 3000 }
  periodSeconds: 5
```

Keep the readiness probe's own `timeoutSeconds` above `timeoutMs`, so a
check that times out is reported by this process — naming the dependency —
rather than by the probe giving up first.

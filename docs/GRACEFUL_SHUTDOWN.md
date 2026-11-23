# Graceful shutdown

A production server finishes the requests already in flight before it
exits. On by default.

## What it fixes

Without it, a request interrupted by `SIGTERM` reaches the client as a
connection error. Measured: a request 300ms into 1500ms of work, signalled,
arrives as `ECONNREFUSED` — not a 502, not a truncated body, the connection
is simply gone. That happens on every deploy, every scale-down and every
rollout, for every request in flight at the time.

With draining, the same request completes with its `200`, and the process
exits `143` (the conventional code for a signalled process, so nothing
downstream reads a clean shutdown as a crash).

## Configuration

```ts
// absolute.config.ts
shutdown: {
	drainTimeoutMs: 10_000,
	readinessGraceMs: 5_000
}
```

| Option | Default | |
| --- | --- | --- |
| `drainTimeoutMs` | `10000` | How long in-flight requests get before the server is stopped anyway |
| `readinessGraceMs` | `0` | How long to keep serving *after* readiness flips, before refusing new connections |

`shutdown: false` restores the old behaviour — the process stops the
instant it is signalled.

Keep `drainTimeoutMs` comfortably under whatever grace period your
orchestrator allows before `SIGKILL` (Kubernetes defaults to 30s). A
deadline longer than that one is not a longer drain; it is a drain that
gets killed halfway.

## Set `readinessGraceMs` if you run behind a load balancer

This is the part that is easy to get wrong, so it is worth stating plainly.

On `SIGTERM` the process immediately starts reporting `shutting-down` from
`/__absolute/ready` (503), so an orchestrator takes it out of rotation. But
**refusing new connections is the first thing a drain does** — so with
`readinessGraceMs: 0`, a probe arriving a moment later cannot connect at
all and gets a connection error rather than that clean 503.

Measured, with the flip in place and working:

| | readiness during the drain | in-flight request |
| --- | --- | --- |
| `readinessGraceMs: 0` | connection refused | completes, `200` |
| `readinessGraceMs: 800` | `unready` | completes, `200` |

So the in-flight request is safe either way — that is what draining is for
— but the *handover* is only clean with a window. Set it to however long
your balancer takes to notice an unready backend, and during that window
the server keeps serving normally.

It defaults to `0` because the right value is your balancer's
deregistration interval, which the framework cannot know, and because a
default wait would slow every `Ctrl+C` for a benefit only an orchestrated
deployment sees.

**`SIGINT` ignores it.** That is an operator at a terminal, not a rollout:
nothing is going to deregister them, so the wait would be pure delay.

## Liveness stays `ok` during a drain

Deliberately. A failing *liveness* probe gets the process killed, which is
the opposite of letting it drain. Liveness answers "is this process
running", and during a shutdown it still is. Only readiness changes.

## It cannot hang

Taking `SIGTERM` means suppressing the default terminate, so whatever
installs a handler has to exit the process itself. A server that hangs
instead of stopping is worse than one that drops requests, because the
operator cannot even stop it normally.

So the deadline is armed before the drain is awaited, and it is unref'd so
it can never hold the process open by itself. When it fires, the server is
force-stopped and the process exits regardless. A stop that throws still
exits.

**A second signal exits at once.** Pressing `Ctrl+C` twice means it, and
waiting out a drain someone is visibly trying to skip is what teaches
people to reach for `SIGKILL`.

## Dev is not affected

Dev servers restart constantly under HMR and the dev CLI already owns that
lifecycle. Draining each rebuild would add a wait to every restart, for a
shutdown nobody is watching.

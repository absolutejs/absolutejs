# Render timeout

```ts
export default defineConfig({
	rendering: { timeout: 30_000 } // the default
});
```

A page render that never finishes otherwise never answers.

## What it was

Measured on a real server, with a React page containing a Suspense
boundary that never resolves:

```
status 200   total 12.0s (client gave up)   bytes 864   no </html>
```

The shell streamed, and then nothing. No error, no close. The only thing
that ends it is Bun's HTTP `idleTimeout` — 240s here — and that reaps the
socket **without an error**, so the visitor's request dies in silence four
minutes later.

## What it is now

Same page, same server, with the default budget:

```
status 200   total 1.6s   bytes 4004   </html> present   fallback rendered
```

React answers an abort properly: it flushes each pending boundary's
fallback and closes the stream. So a cut-off render is a complete page
showing its loading state, rather than a connection that dies quietly.

## The default is generous on purpose

Thirty seconds. This framework is meant to host streaming and AI
workloads, where a render legitimately waits on a slow upstream — the same
reasoning gave `idleTimeout` its 240s.

A boundary still pending after thirty seconds is a bug or a dead upstream
far more often than it is a slow one, and either way a page with its
fallback beats a hang. Raise it if your renders are genuinely longer:

```ts
rendering: { timeout: 120_000 }
rendering: { timeout: false }    // unbounded, the old behaviour
```

## What it covers

**React's streaming render.** The abort reaches `renderToReadableStream`,
which is what makes the fallback-flush behaviour possible.

**Not Svelte.** Its renderer builds the whole document before the first
byte and only chunks the result, so the `signal` it accepts stops the
chunking of HTML that already exists rather than the render itself.
Bounding that needs a different mechanism and is not pretended here.

**Not streaming slots** — they are already bounded, five seconds per slot,
and a slot that sets its own `timeoutMs` keeps it. A first draft of this
tried to give slots the render budget as a default; the change was dead
code, because the slot policy fills that field in before anything reads
it.

## Details

The timer is unref'd, so a pending budget never keeps a process alive —
which matters for `absolute export`, where the process should exit once
the pages are written.

The budget covers the render, not the transfer: once a stream finishes,
the timer is cleared rather than left armed against a controller nobody
reads.

`rendering` is in the production runtime config allowlist. Leaving it out
would have meant the budget worked in dev and silently did nothing in
production — which is where a hung render actually costs something, and
exactly the mistake `basePath`, `logging` and `shutdown` each made before.

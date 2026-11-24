# Why an Angular render returns before Angular says it is done

An Angular page here is handed back the moment its HTML is serialized,
not when `renderApplication` resolves. This is the measurement behind
that, read through the Universal Scalability Law, because the law is
what made the problem visible.

## The shape that gave it away

Closed-loop load against the example app's production build — N
connections, each sending its next request as soon as the last returns:

| N | Angular | React | Vue | Svelte |
|---|---|---|---|---|
| 1 | 575 | 11,168 | 13,434 | 16,317 |
| 4 | 2,549 | 16,322 | 27,149 | 31,400 |
| 16 | 3,655 | 16,290 | 32,309 | 24,764 |

Requests per second. Angular is twenty times slower at one connection —
and then does something the others do not: it gets **six times faster**
as load rises, on a server with one thread.

One thread cannot run two renders at once. The only thing that can
overlap is *waiting*. So most of an Angular request was not work.

Fitted to `X(N) = λN / (1 + α(N−1) + βN(N−1))`, Angular's contention
term α came out at **0.09** where the others sit between 0.35 and 0.58.
A low α normally means little serial work. Here it meant the request
was mostly idle, which scales perfectly.

## What it was waiting for

`renderApplication` ends like this:

```js
const rendered = await renderInternal(platformRef, applicationRef);
return rendered;
} finally {
  await asyncDestroyPlatform(platformRef);   // setTimeout(() => destroy(), 0)
}
```

The HTML is finished, and the caller waits out a timer for a teardown
that cannot change it. A timer is not free:

| | |
|---|---|
| bare `setTimeout(0)` hop | 1.144 ms |
| one render, sequential | 1.360 ms |
| one render, 400 at once | 0.140 ms |

Nine tenths of every Angular render was a timer tick.

## The hand-off

`BEFORE_APP_SERIALIZED` callbacks run immediately before
`PlatformState.renderToString()` — the one call that produces the
document, after hydration annotation and after every other callback has
settled. A callback wraps that method on this request's own
`PlatformState`, and the wrapper resolves a promise with exactly the
string `renderApplication` is about to return. That promise is raced
against `renderApplication` itself.

Public API only, and it fails toward the old behaviour: if a future
Angular stops calling the wrapped method, the race is simply won by the
slow path. Output is byte-identical.

## After

| N | before | after |
|---|---|---|
| 1 | 575 req/s, p50 1.60 ms | **2,627 req/s, p50 0.32 ms** |
| 4 | 2,549 | 4,771 |
| peak | 3,655 | 4,771 |

4.6× at one connection, 1.3× at the peak, and α moved from 0.09 to
about 0.5 — the request is CPU-bound now, like the others. Angular
islands go through the same render, so each island on a page stops
paying its own tick as well.

## What changes besides the time

Teardown runs one tick *after* the page is returned instead of before.
`ngOnDestroy` and `DestroyRef` callbacks still fire.

One case gets better. An `ngOnDestroy` that throws on the server leaves
stock `renderApplication` **pending forever**: Angular destroys the
platform inside the timer callback and resolves only afterwards.
Measured — still pending after two seconds. The request used to hang
until the render timeout; the page is now already delivered. The
uncaught exception in Angular's timer is still raised.

## The work that was left (beta.348)

With the waiting gone, a CPU profile of the production server under
load showed where the remaining 0.23 ms went — and three pieces of it
were this framework's, not Angular's.

**A router built for pages with no routes — 13.5% of server CPU.** The
server watches the Angular router so that a guard's redirect becomes an
HTTP redirect, and it found the router with
`inject(Router, { optional: true })`. That does not mean "only if this
page has one": `Router` is `providedIn: 'root'`, so asking for it
*builds* one — router, location, history state manager — on every
request. It also quietly undid the build's own rule of wiring the router
only into pages that export `routes`. The watcher now asks for `ROUTES`
first, which has no root factory and so exists only when `provideRouter`
ran.

**A filesystem call and a dynamic import per request.** Finding
`@angular/router` resolved a vendor path with an `existsSync` in it and
then imported it, every time, for an answer that cannot change under a
running production server. Now done once.

**Five passes over the page to add five scripts.** Each injected
snippet was its own search-and-copy of the whole document. They all land
in the same place in the same order, so they are joined and inserted
once.

Steady load, eight connections, median of three runs:

| | req/s | CPU per request |
|---|---|---|
| before | 4,343 | 0.230 ms |
| after | 5,154 | 0.194 ms |

19% more throughput. Reading the profile also turned up a bug in the
insertion itself — see `src/utils/insertBeforeMarker.ts`.

### One profiler trap

The first profile put `isAbsoluteRequestStorage` — a six-line type
guard — at the top with 957 ms of self time. It was **one sample**: an
idle gap attributed to whatever was on the stack. Anything in a sampled
profile with a large time and a sample count of one is not a hot
function. The numbers above come from re-aggregating the raw samples
with long ones dropped.

## What is left, and one thing declined

What remains is Angular's own per-request work: rendering the view
(about 18% of CPU), parsing the page shell (12%), serializing it (9%),
annotating for hydration (4%), tearing the platform down (5%) and
creating it (3%).

**Parsing the shell was measured and deliberately not taken.**
`renderApplication` accepts a `Document`, and a pristine one can be
obtained and cloned through public API alone — output byte-identical,
and 20–35 µs faster per render. It was declined because a cloned
document does not have the request's URL applied to it, so server code
reading `document.location` would see the wrong address; and because
the shell differs per request whenever the head does (a title, a CSP
nonce), which means a cache keyed on a per-request string. Roughly 10%
of CPU is not worth either.

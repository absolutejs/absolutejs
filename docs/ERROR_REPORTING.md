# Error reporting

Server-side errors went to `console.error` and nowhere else. On a server
that is a line in a log nobody reads: the error is known to the process and
to no one. `onServerError` hands it somewhere.

The ecosystem's own exception capture is
[`@absolutejs/errors`](https://www.npmjs.com/package/@absolutejs/errors) —
fingerprinting, grouped issues, a durable store, audit events and OTel span
recording — so that is what a reporter should normally hand them to:

```ts
import { onServerError } from '@absolutejs/absolute';
import { createErrorTracker, createMemoryIssueStore } from '@absolutejs/errors';

const errors = createErrorTracker({
	environment: 'production',
	project: 'acme',
	release: process.env.RELEASE,
	store: createMemoryIssueStore() // or @absolutejs/errors-postgres
});

onServerError((report) =>
	errors.captureException(report.error, {
		extra: { page: report.page, requestId: report.requestId },
		tags: { framework: report.framework, kind: report.kind },
		target: report.path
	})
);
```

`captureException` is the promise edge of `capture`, and capturing an error
can never itself fail — which suits a reporter exactly: the promise is not
awaited, and a rejection would only have been caught and printed.

Call `onServerError` once, wherever your server starts. It returns a
function that removes the reporter. Nothing here is coupled to that
package: a reporter is a plain function, so a project already sending
exceptions somewhere else keeps doing that.

## The report

| | |
| --- | --- |
| `error` | What was thrown |
| `kind` | `page`, `stream`, `hole` or `load` — see below |
| `framework` | Which framework's handler, when it was one |
| `page` | The page name, or the route source for a `load` |
| `method`, `path` | The request, when there was one |
| `requestId` | The same id the access log line carries |

`requestId` is the point of pairing this with
[request logging](LOGGING.md): a captured issue and a line in your log
pipeline can be matched up, and so can the id a user quotes from a response
header.

The **query string is deliberately not included.** It can carry a session
token or an email, and the path is enough to say which route failed.

### The kinds are not interchangeable

- **`page`** — a render that threw before anything was sent. The visitor
  got an error page, and the status code says so.
- **`stream`** — a render that threw *after* the first byte. The visitor
  has a partial page and no status code can say so, which is exactly why
  this one is worth telling apart in an alert.
- **`hole`** — a partial-prerender slot failed and its fallback stands. The
  visitor got a usable page: a degradation, not a failure, and probably not
  something to page anyone about at 3am.
- **`load`** — a file route's `load` function threw.

## `console.error` still happens

A reporter is additive. The terminal is where someone running the thing
locally looks, and a framework that goes quiet because a reporter was
registered has traded one blind spot for another.

## What a reporter cannot do

Reporters run inside the `catch` that is already handling a failed render,
so they are isolated:

- **Break the request.** A reporter that throws is caught, its own failure
  printed, and the remaining reporters still run. The visitor still gets
  the error page.
- **Delay the response.** A returned promise is not awaited — only its
  rejection is caught — so an error page never waits on a network round
  trip to your error service.
- **Loop.** A reporter's own failure goes to the terminal and *not* through
  the reporters. Reporting it through them is how a reporter that always
  throws writes a stack overflow.

Reporters are registered on `globalThis` behind a `Symbol.for`, like the
health checks and the request context, so a reporter registered from your
own bundle is reached by the framework runtime even when they are separate
module copies.

## Browser errors, and source maps

This hook is the **server** side. Errors in the browser are
[`@absolutejs/beacon`](https://www.npmjs.com/package/@absolutejs/beacon),
which captures uncaught errors and unhandled rejections with breadcrumbs
and posts them to `@absolutejs/errors`'s ingest endpoint — where
symbolication and redaction already live, and where a source-mapped copy of
a failure groups with its raw counterpart across releases.

So the source-map half of plan item 5.15 is not a gap in this framework to
fill later: it belongs to those two packages, which have it. What was
missing here was that render errors never reached either of them, because
nothing in this framework offered a way out. That is what this is.

### Why an Elysia-level error hook is not enough

`@absolutejs/errors` ships `errorsPlugin` for Elysia, which hooks Elysia's
error lifecycle. That does not see these errors. Each page handler
**catches its own** render failure in order to render the error convention
(`<Page>.error.html`, `error.html`) and returns a 500 response — so the
error never propagates as an Elysia error and an `onError` hook never
fires. Mounting that plugin and nothing else would therefore report
everything except the SSR failures. These nine sites are the inside of
those catches.

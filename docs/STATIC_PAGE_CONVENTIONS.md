# Error and not-found pages for HTML and HTMX

HTML and HTMX pages use the same file conventions as the React, Svelte, Vue
and Angular pages: put the files next to your pages and AbsoluteJS finds
them at build time.

| File | Used when |
| --- | --- |
| `<Page>.error.html` | `<Page>.html` throws |
| `error.html` | any page throws and it has no page-specific error file |
| `not-found.html` | no route matches the request |

## Error pages

`handleHTMLPageRequest` and `handleHTMXPageRequest` render the error page
when the page can't be served: its file is missing or unreadable, or it
fails a static-page check (for example an `<abs-stream-slot>` in an HTML
page that passed no `streamingSlots`). The response has status 500, and the
error is logged on the server.

### Errors thrown by route handlers

A route handler that throws before it returns a page, for example

```ts
.get('/account', () => {
	throw new Error('database unavailable');
})
```

also renders `error.html` with status 500, when the request is a page
request: a browser navigation (`Accept: text/html`) or an HTMX request
(`HX-Request: true`). HTMX requests try `htmx/pages/error.html` first, then
`html/pages/error.html`; other requests try them the other way round.
Outside development the page shows the generic message
`Something went wrong while rendering this page.` and an empty
`{{ stack }}`, so neither the error message nor any file path reaches the
browser. The error is logged on the
server.

What this doesn't cover:

- Requests that aren't page requests, such as `fetch()` calls or JSON API
  requests, keep Elysia's default error response.
- Errors Elysia raises itself (not found, validation, parse errors) and
  thrown `status(...)` responses keep their own status and handling.
- `<Page>.error.html` files aren't matched from a route: a route isn't tied
  to a page file, so the directory's `error.html` is used.
- It needs an `error.html` (or a `<Page>.error.html`) in the HTML or HTMX
  pages directory. Without one, the route gets Elysia's default response.
- If your app registers its own `onError`, before or after
  `.use(absolutejs)` or as a global hook in another plugin, AbsoluteJS
  leaves these errors to it and doesn't render `error.html`. An `onError`
  with the default local scope inside a sub-plugin isn't counted, because
  Elysia doesn't share it with the app.
- Your app's own `onError` is found when the server starts with
  `.listen()`, which covers `absolute dev`, `absolute start` and compiled
  binaries. An app that only calls `app.handle()` (some tests and
  serverless setups) still gets `error.html` for these requests, and an
  `onError` it registers after `.use(absolutejs)` doesn't see them.

The error page can show the error with three placeholders:

```html
<h1>Something went wrong</h1>
<p>{{ message }}</p>
<pre>{{ stack }}</pre>
```

`{{ name }}` and `{{ message }}` are always filled in (HTML-escaped).
`{{ stack }}` is filled in only in development. In production it's empty,
so no stack trace reaches the browser.

Lookup order:

- **HTMX pages:** `htmx/pages/<Page>.error.html`, then
  `htmx/pages/error.html`, then the shared error page below.
- **HTML pages, and the shared fallback:** `<Page>.error.html` or
  `error.html` from the first pages directory that has one, in this order:
  React, Svelte, Vue, Angular, Ember, HTML, HTMX. The other frameworks also
  fall back to it when they have no error page of their own.

Without any error page, the built-in AbsoluteJS error page is shown.

## Not-found pages

A request that matches no route renders the first `not-found` page found,
in this order: React, Svelte, Vue, Angular, HTML, HTMX.

An HTMX request (one with the `HX-Request: true` header) tries
`htmx/pages/not-found.html` first, so a swap that targets a missing route
gets HTMX markup rather than a full HTML document.

`error.html` and `not-found.html` may exist in both the HTML and the HTMX
directory; that doesn't count as a page name collision.

## Loading pages

`loading.html` isn't supported for static pages. A loading page is shown
while a framework page renders on the server. A static page is a file sent
as-is, so there's nothing to wait for. Use streaming slots
(`<abs-stream-slot>` with `streamingSlots`) for parts of a page that load
later.

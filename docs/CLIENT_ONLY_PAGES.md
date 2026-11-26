# Client-only pages: `ssr: false`

Every page is rendered on the server by default. A page can opt out: the
server then sends the document shell — head, props and scripts — and the
browser renders the page.

```ts
// server.ts
.get('/dashboard', ({ request }) =>
	handleReactPageRequest({
		index: asset(manifest, 'DashboardIndex'),
		Page: Dashboard,
		props: { team: 'core' },
		request,
		ssr: false
	})
)
```

The option is the same on `handleReactPageRequest`,
`handleSveltePageRequest`, `handleVuePageRequest` and
`handleAngularPageRequest`.

For a file route, export it from the route's server module:

```ts
// react/routes/dashboard.server.ts
export const ssr = false;

export const load = async () => ({ team: 'core' });
```

## When to use it

- The page is built on a library that needs `window` or `document` to
  load or render: a map, a rich-text editor, a charting canvas.
- The page is behind a login and shows a spinner until its data arrives
  either way, so a server render would only produce the spinner.

If only **part** of a page needs the browser, use an island instead: the
rest of the page is still server-rendered, and only that component waits
for JavaScript.

## What it costs

Turning this on gives up what server rendering provides, for that page:

- The response contains none of the page's content. A crawler, a link
  preview or a visitor without JavaScript sees an empty document.
- The first paint waits for the page's bundle to download and run.
- For React, the `<head>` is part of the page component, so the title and
  meta tags are also absent until the browser has rendered. Svelte's
  `<svelte:head>` is the same. Vue and Angular keep the `headTag` passed to
  the handler, since that is written by the server.

Leave it off unless the page cannot do without it.

## What does not change

- **The route still runs on the server for every request.** Its handler,
  its guards, `beforeHandle`, `load`, redirects and status codes all behave
  as before. Only the render is skipped.
- **Props arrive the same way.** They are serialized into the shell and the
  page renders with them, so `load` is not called a second time from the
  browser.
- **Styles.** Stylesheets linked from the head, and the page's compiled
  CSS, are in the shell or loaded by the page's entry as usual.
- **Dev and production** both honour it, and an edit to a client-only
  page shows in the open browser as it does for any other page.

## For file routes

- `export const ssr = false` must be the literal `false`. Anything else
  leaves the route server-rendered.
- For a React route, the page's module is not imported on the server at
  all. That matters: a library that touches `window` as it loads fails at
  import, before any render, so skipping only the render would not help.
- It does nothing for an HTML or HTMX route, which is served as the file it
  is, and the route scan reports it there.

## What it cannot be combined with

- `client: 'none'` on a Vue page. That option ships no client JavaScript,
  so together the two would leave nothing to render the page; the handler
  throws.
- Streaming slots and `useServerData` have nothing to do on the server for
  such a page. Data the page needs comes from its props, or is fetched in
  the browser.

Islands work inside a client-only page. The server cannot know which
islands such a page will render, so its shell carries the island runtime
and every island stylesheet whenever the app has islands at all.

## Not included

There is no app-wide switch, on purpose: server rendering is what the
framework is for, and one global setting would make it easy to turn off to
hide a hydration bug rather than to solve a real constraint.

`absolute export` does not yet write a fallback shell for client-routed
deep links on a static host.

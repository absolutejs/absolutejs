# `defineLoader` and `loadAll`

Fetch a page's data once per request, and wait for all of it together.

```ts
// loaders.ts
import { cookies, defineLoader } from '@absolutejs/absolute';

export const currentUser = defineLoader(async () =>
	getUser(cookies().get('session'))
);
export const stats = defineLoader(async () => getStats());
export const post = defineLoader(async (slug: string) => getPost(slug));
```

```ts
// routes/dashboard/[slug].server.ts
import { loadAll } from '@absolutejs/absolute';
import { currentUser, post, stats } from '../../loaders';

export const load = async ({ params }) =>
	loadAll({
		post: post(params.slug),
		stats: stats(),
		user: currentUser()
	});
```

The page receives `{ post, stats, user }`, each typed from its loader. The
three run at the same time, so the wait is the slowest one's rather than
the sum.

Both work the same in a route registered in `server.ts`:

```ts
app.get('/dashboard', async ({ request }) =>
	handleReactPageRequest({
		index: asset(manifest, 'DashboardIndex'),
		Page: Dashboard,
		props: await loadAll({ stats: stats(), user: currentUser() }),
		request
	})
);
```

## `defineLoader`: once per request

A loader is an async function wrapped so that it runs **once per request**,
however many places call it. The first call runs it; every later call in
the same request is handed that call's promise.

That is what lets data be asked for where it is needed. A folder's guard
checks the user, the route's `load` reads the user for the page, a helper
reads it again to decide what to show:

```ts
// routes/admin/layout.server.ts
export const beforeHandle = async ({ redirect }) =>
	(await currentUser())?.role === 'admin' ? undefined : redirect('/login');

// routes/admin/users.server.ts
export const load = async () =>
	loadAll({ user: currentUser(), users: listUsers() });
```

One query, not two. Nothing is fetched "at the top" and passed down.

A loader takes no request: read it with
[`headers()` and `cookies()`](./REQUEST_HELPERS.md).

### What "the same call" means

A loader with arguments is held once per distinct set of arguments:
`post('intro')` twice is one run, `post('intro')` and `post('other')` are
two.

Arguments are compared by content. Strings, numbers, booleans, `null`,
`undefined`, bigints, dates, and arrays and plain objects made of those
all compare; an object's key order does not matter. Values that only look
alike stay apart (`1` and `'1'`, `null` and `undefined`).

A call given anything else — a class instance, a `Map`, a function — is
not held and runs every time. That direction is deliberate: a missed match
costs a second run, a wrong match would hand one caller another's data.
Pass an id rather than the object it belongs to.

### What a request covers

- **Nothing is shared between requests.** Two requests in flight at once
  each run the loader and each get their own value, so a loader is safe
  for data that depends on who is asking. For a value shared across
  requests, cache it yourself inside the loader.
- **A failure is held too.** If the first call rejects, later calls in
  that request get the same rejection without a second attempt.
- **A value is held for the rest of the request.** If the request then
  changes that data, a later call still returns what was read before the
  change. Read it directly after writing.
- **Outside a request there is nothing to hold it in**, so every call
  runs: at build time from `entries()`, in a script, in a test. It also
  needs the plugin `prepare()` returns to be mounted, as every AbsoluteJS
  app does.

## `loadAll`: together

`loadAll` takes an object of promises (or plain values) and resolves to an
object with the same keys. It is `Promise.all` that keeps the names.

The entries start when you call the loaders, not when `loadAll` receives
them — what happens together is the waiting. So this is still a waterfall:

```ts
const user = await currentUser(); // waits
const all = await loadAll({ stats: stats() }); // then starts
```

When one entry needs another's result, that is a real dependency: await
the first, then `loadAll` the rest.

Passing a loader without calling it — `{ user: currentUser }` — is a type
error, and throws if it gets past the types.

### When an entry fails

By default `loadAll` rejects with the failed entry's own error, unchanged.
A `NotFound` thrown inside a loader therefore still renders the not-found
page, and any other error still renders the route's error page.

To let the page render without one of its sources, ask for partial
results:

```ts
import { LoaderError, loadAll } from '@absolutejs/absolute';

export const load = async () => {
	const data = await loadAll(
		{ stats: stats(), user: currentUser() },
		{ partial: true }
	);

	return {
		stats: data.stats instanceof LoaderError ? null : data.stats,
		user: data.user instanceof LoaderError ? null : data.user
	};
};
```

Each value is then typed as its result or a `LoaderError`, which carries
the entry's `key` and the original error as `cause`. Nothing is logged or
reported for you; the error is yours to handle.

`partial` tolerates a source being down. A `NotFound`, or a `Response`
thrown as a redirect, is still thrown: those answer the request, and
swallowing one would render a page for something that does not exist.

## `invalidate()`: after the data changes

A page gets its data once, as it is rendered. After the browser changes
that data, the page on screen shows how things were. `invalidate()` asks
the server for the page's data again and shows it:

```ts
import { invalidate } from '@absolutejs/absolute/client';

await fetch('/api/todos', { body, method: 'POST' });
await invalidate();
```

The route's `load` runs again and the page shows the result. The address
and the history entry stay as they were, the visitor stays where they
were on the page, focus stays on the element that had it, and there is
no view transition. It never answers from the HTTP cache or from a
prefetched copy of the page.

It works on every kind of page — React, Svelte, Vue, Angular, HTML, HTMX —
because the browser keeps no second copy of the data: the server remains
the one place a page's data is put together.

### After a form action

A form action does it for you. Once an action succeeds without
redirecting, the page's data is refreshed, so the new row is in the list
without any code asking for it.

That refresh only ever keeps the page. A React, Svelte or Vue page, and an
Angular page that reads `usePageData()`, is handed new props; an HTML or
HTMX page is morphed. What was typed, what is open, and the form's own
success message all stay. A page that cannot be refreshed that way (see
below) is left exactly as it is, and never reloaded.

Two settings change that:

```tsx
// Refresh at any cost, as invalidate() does: a page that cannot be kept
// is mounted again or reloaded.
const add = actions.useFormAction('/actions/add-todo', { invalidate: true });

// Never refresh: the action changes nothing this page shows.
const ping = actions.useFormAction('/actions/ping', { invalidate: false });
```

```html
<form action="/actions/add-todo" method="post" data-absolute-action data-action-invalidate>
<form action="/actions/ping" method="post" data-absolute-action data-action-invalidate="false">
```

The option is on every binding (`useFormAction` in React, Vue and Angular,
`formAction` in Svelte) and on `submitFormAction`. Nothing is refreshed
for a result that redirects, or for a failed submission, whose errors stay
on screen.

The refresh costs one request for the page per successful submission. An
API call made through `createApiClient` is different: it refreshes only
when asked (`invalidate: true`), because most API calls change nothing
the page shows.

### Whether the page keeps its state

It depends on what kind of page it is.

**A React, Svelte or Vue page is given new props and is not unmounted.**
Everything its components hold survives: an open menu, text typed into a
field, a form binding's `data` and success state. Only what the new props
change is re-rendered, including anything the page derives from them. A
prop the new data no longer has is cleared. This needs no navigation
layer.

**An Angular page is too, if it reads its data as a signal.** See below.

**An HTML or HTMX page is morphed.** It has no props; its state is the
document. The page is fetched again and the document on screen is changed
into it node by node, keeping every node that is still wanted. See below.

**An Angular page that reads its data with `usePageContext()` is fetched
whole and swapped in.** It is the one kind of page that still mounts
again. The page is mounted again, so state
its own components hold starts over. That is why a form action does not
refresh such a page on its own: set `invalidate: true` on a form whose
outcome shows in the page's data (the new row in the list), not on one
that shows a "saved" message from its own state. An
island marked `persist` keeps its state, as it does across any soft
navigation.

A React, Svelte or Vue page is also swapped whole whenever giving it new props would be
wrong: the request for its data was redirected, the route now renders a
different page (a session that expired), or the server did not answer
with data. Those are handled the way a reload would handle them.

### Angular: read the data as a signal

An Angular page takes its data from the handler's `requestContext`. There
are two ways to read it, and which one a page uses decides how it is
refreshed.

```ts
import { usePageData } from '@absolutejs/absolute/angular';

export class TodosPage {
	private data = usePageData<{ todos: Todo[] }>();
	todos = computed(() => this.data().todos);
	open = signal(false); // survives a refresh
}
```

`usePageData()` returns a signal. Read it in the template or through
`computed`, and `invalidate()` sets it: Angular re-renders what read it
and the page's own state is kept. It works with `OnPush` and zoneless
change detection.

`usePageContext()` returns the object itself, and a page usually copies
out of it as it is constructed:

```ts
private ctx = usePageContext<{ todos: Todo[] }>();
todos = this.ctx.todos; // a copy, in a plain field
```

Nothing can update that field afterwards. Changing the rest of the page
around it would show two answers at once, so a page that calls
`usePageContext()` — or injects `REQUEST_CONTEXT` itself — anywhere is
refreshed whole, as before. It is never left half-updated.

To get in-place refresh on an existing page, switch its reads to
`usePageData()` and derive from the signal instead of copying.

### HTML and HTMX: the document is morphed

What survives a refresh, because the node holding it is kept:

- text typed into a field, a ticked box, a chosen option;
- an open `<details>` or `<dialog>`;
- listeners and anything else a script attached to an element;
- scroll position, including inside a scrolling element.

Elements are matched by `id`, then by `data-key`, then by position. Give
the rows of a list an `id` or a `data-key` and a row that moves is moved,
and one added at the top goes to the top without disturbing the rest.

What is left alone entirely:

- an island (`data-island="true"`), which a framework owns;
- anything marked `data-absolute-preserve` or `hx-preserve`. Use it for
  an element whose content a script writes: without it, the element's
  text and attributes are brought back to what the server sent;
- scripts. One already on the page is not run again, and a new one in
  the fresh copy is not run at all.

On an HTMX page, markup that arrives in a refresh is handed to
`htmx.process()`, so its `hx-*` attributes work. Content HTMX loaded into
the page earlier is not in the server's fresh copy and is replaced by it;
that is the nature of asking the server for the page again. An HTMX page
usually has a better tool for this than `invalidate()`: have the response
swap the fragment, or trigger the element to reload itself.

The page is fetched whole and swapped instead when morphing would not be
enough: the request was redirected, the fresh copy loads different
stylesheets, or it holds a different number of islands.

### How it ended

The promise resolves to one of:

| Outcome | Meaning |
| --- | --- |
| `'updated'` | The mounted page was given new data. Nothing was torn down. |
| `'swapped'` | The page was fetched whole and replaced in place. |
| `'reloaded'` | The browser was asked to load the page: there is no navigation layer (`enableNavigation()`), or the page cannot be torn down. |
| `'superseded'` | A newer navigation or refresh started first. |
| `'cancelled'` | An `absolute:before-navigate` listener refused it. The event's `type` is `'refresh'`. |

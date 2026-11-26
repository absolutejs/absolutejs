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

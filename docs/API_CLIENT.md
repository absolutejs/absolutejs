# The typed API client

Call your app's own routes from the browser, with their types.

```ts
// api.ts
import { createApiClient } from '@absolutejs/absolute/client';
import type { server } from './server';

export const api = createApiClient<typeof server>();
```

```ts
const { data, error } = await api.get('/todos/:id', { params: { id: '3' } });

await api.post('/todos', { body: { title: 'Ship it' }, invalidate: true });
```

There is nothing to add on the server. A route is the server function: its
guards, its validation and its handler run as they do for any request. The
client reads the types Elysia already keeps for it.

`server` is imported as a **type**, so no server code reaches the browser.
For the types to exist, export the app with its inferred type — an app
annotated `AnyElysia` has had them erased.

## Calls

`api.get`, `api.post`, `api.put`, `api.patch` and `api.delete` each take a
route's path, exactly as it was registered, and that route's options:

| Option | What it is |
| --- | --- |
| `params` | The path's params. Required when the path has any. `'*'` is the name of a wildcard's. |
| `query` | The query the route declares. An array is sent as a repeated key; `undefined` and `null` are left out. |
| `body` | What the route's `body` schema accepts. Sent as JSON, unless it is a `FormData`, `Blob`, `URLSearchParams`, string or buffer, which are sent as they are. |
| `headers` | Extra headers for this call. |
| `signal` | An `AbortSignal`. |
| `invalidate` | `true` refreshes the page's data after the call succeeds. |

All of it is checked: a path no route serves, a method the path does not
answer, a missing param, a body of the wrong shape and a query key the
route does not declare are each a compile error. Rename a route and every
caller fails to compile.

A call that changes something (anything but `get`) carries the CSRF token
when the page has one, as form actions do.

## Results

A call resolves to `{ data, error, status, response }`. It does **not**
reject for an HTTP error or a failed request, so the failure paths are in
the types and cannot be forgotten:

```ts
const { data, error } = await api.get('/todos/:id', { params: { id } });
if (error) {
	if (error.status === 404) return showMissing(error.value); // typed
	return showFailure(error.status);
}
render(data); // typed, and not null here
```

- `data` is what the route answers on success, typed from its handler or
  its `response` schema.
- `error` is `null` on success. Otherwise it is `{ status, value }`: typed
  per status for the errors the route declares, `unknown` for one it does
  not (a proxy's 502), and `{ status: 0, value: Error }` when the request
  got no answer at all.
- `response` is the raw `Response`, absent when there was no answer.

The body is read by its content type: JSON is parsed, text is a string, a
204 is `undefined`, anything else is a `Blob`. A handler that returns a
`Response` it built itself types `data` as `unknown`.

An aborted call is the one case that rejects, with the abort error.

## After a change

`invalidate: true` fetches the page again once the call has succeeded, so
the page shows what the call changed. See
[`invalidate()`](./DATA_LOADING.md#invalidate-after-the-data-changes) for
what that does and what it costs.

## Options

```ts
createApiClient<typeof server>({
	baseUrl: 'https://app.example', // default: the page's own origin
	headers: () => ({ authorization: `Bearer ${token()}` }),
	fetch: customFetch
});
```

Outside a browser there is no origin to be relative to, so give `baseUrl`.

## Forms

For a form, use a [form action](./FORM_ACTIONS_PLAN.md) and its client
instead: it works without JavaScript and gives per-field errors. This
client is for everything else a page asks its server.

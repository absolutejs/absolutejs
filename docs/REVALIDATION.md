# Revalidating pre-rendered pages

A route listed in `static.routes` is rendered once, at build time, and
served from a file. `revalidatePath` and `revalidateAll` re-render it when
the app knows its data changed.

```ts
import { revalidatePath } from '@absolutejs/absolute';

app.post('/admin/posts/:slug', async ({ body, params }) => {
	await db.posts.update(params.slug, body);
	await revalidatePath(`/blog/${params.slug}`);

	return { saved: true };
});
```

Without this, a pre-rendered page changes only when `static.revalidate`
(a number of seconds) runs out, or at the next deploy.

## Pre-rendering a dynamic route

A path in `static.routes` with a param in it names a dynamic file route,
and stands for one page per param set that route's `entries()` returns:

```ts
// absolute.config.ts
static: { routes: ['/', '/about', '/blog/:slug'] }

// routes/blog/[slug].server.ts
export const entries = async () =>
	(await db.posts.all()).map((post) => ({ slug: post.slug }));
```

`/blog/hello`, `/blog/world` and the rest are pre-rendered at build time.
`entries()` is the same export the sitemap reads, so the two agree.

Write the pattern as `route()` takes it: `:name` for `[name]`, `:name?`
for `[[name]]`, and the name the file gave a catch-all (`/docs/:rest` for
`docs/[...rest]`). The config offers the project's file routes as
completions.

A pattern that cannot become pages is printed as a pre-render failure,
never skipped quietly:

- no file route has that path (a route registered in `server.ts` has no
  `entries()`, so list its pages one by one);
- the route has no server module, or it does not export `entries()`;
- `entries()` threw, or did not return an array;
- a set is missing a param — that one page is skipped and named, the rest
  are rendered.

`entries()` runs on the machine doing the build, so it needs to reach
whatever it reads. Pages are rendered four at a time.

A page that did not exist at build time is rendered per request, like any
route that is not pre-rendered.

## `revalidatePath(path)`

Re-renders the pre-rendered page at `path` and replaces the file visitors
are served. Resolves to `true` once the new page is in place, and to
`false` when nothing was replaced:

- the path is not one of the pre-rendered routes;
- the render failed, in which case the previous page stays;
- nothing is pre-rendered at all, as in `absolute dev`.

It does not throw, so a handler can call it unconditionally.

Await it to be sure the next request gets the new page. Call it without
`await` to refresh in the background and answer sooner.

A trailing slash, a query string and a full URL are all read as the route:
`/blog/`, `/blog?page=2` and `https://example.com/blog` mean `/blog`.

## `revalidateAll()`

Re-renders every pre-rendered page and resolves to
`{ revalidated: string[], failed: string[] }`. A route in `failed` keeps
its previous page.

## What a caller is promised

- **A render that started after you asked.** If a re-render of the same
  route is already under way, it began before your change and may have
  read the old data, so your call waits for the next one. However many
  callers ask during that wait, they share it.
- **No half-written page.** The new page is written where no request
  reads, then moved into place. A request gets the old page or the new
  one.
- **The old page on failure.** A render that errors, or is cut short,
  replaces nothing.

## Limits

- **Only routes pre-rendered at build time.** The set is fixed when the
  server starts; `revalidatePath` cannot add a page that was not in
  `static.routes`.
- **One server.** The call re-renders through the server it runs in and
  rewrites that server's files. Several instances each hold their own
  copy, so call it on each, or put the pre-render directory on storage
  they share. Workers of one clustered server share the directory; for
  the length of a rename, another worker can read a page's files from two
  different renders.
- **The server must be reachable on its own port.** A re-render is a
  request the server makes to itself on `PORT`.
- **Dynamic holes are not involved.** A partially pre-rendered page's
  holes render per request already; this refreshes the static shell.

## With `invalidate()`

`invalidate()` on the client fetches the current page again. If that page
is pre-rendered, revalidate it first, or the refresh is handed the same
old file:

```ts
// server
.post('/api/todos', async ({ body }) => {
	await db.todos.insert(body);
	await revalidatePath('/todos');
})

// browser
await api.post('/api/todos', { body, invalidate: true });
```

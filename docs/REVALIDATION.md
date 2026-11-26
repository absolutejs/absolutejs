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
  `entries()`, so the build pre-renders none of its pages: list them one
  by one, or let `revalidatePath` create each one);
- the route has no server module, or it does not export `entries()`;
- `entries()` threw, or did not return an array;
- a set is missing a param — that one page is skipped and named, the rest
  are rendered.

`entries()` runs on the machine doing the build, so it needs to reach
whatever it reads. Pages are rendered four at a time.

A page that did not exist at build time is rendered per request until
`revalidatePath` is called for it, which gives it a file: see below.

## `revalidatePath(path)`

Makes the pre-rendered copy of `path` match what the app serves now. The
page is rendered again, and then one of three things happens:

| The render | What happens | Resolves to |
| --- | --- | --- |
| produced the page | its file is replaced, or created | `true` |
| said the path is no longer a page | its file is deleted; the route renders per request | `true` |
| failed | nothing; the previous page stays | `false` |

It also resolves to `false`, without rendering, for a path `static.routes`
does not cover, and everywhere nothing is pre-rendered, as in
`absolute dev`. It does not throw, so a handler can call it
unconditionally.

Await it to be sure the next request gets the result. Call it without
`await` to do the work in the background and answer sooner.

A trailing slash, a query string and a full URL are all read as the route:
`/blog/`, `/blog?page=2` and `https://example.com/blog` mean `/blog`.

### A page that did not exist at build time

A post published after the deploy has no file. Call `revalidatePath` for
it and it gets one, provided `static.routes` covers its path: a path it
lists, one a pattern in it matches (`/blog/:slug`), or any path under
`routes: 'all'`.

```ts
app.post('/admin/posts', async ({ body }) => {
	const post = await db.posts.insert(body);
	await revalidatePath(`/blog/${post.slug}`);
});
```

This works for a route registered in `server.ts` too. The build cannot
enumerate such a route, so a pattern for it pre-renders nothing at build
time, but each page can be created this way.

`:name` covers exactly one path segment and `:name?` one or none. To
cover everything below a path, as a catch-all route does, write
`/docs/*`: the catch-all's own name (`/docs/:rest`) is one segment here.

### A page that no longer exists

When the re-render is answered with a 404, a 410, a redirect, a 401 or
403, or anything that is not HTML, the path is no longer a page: its file
is deleted and the route is rendered per request from then on.

```ts
app.delete('/admin/posts/:slug', async ({ params }) => {
	await db.posts.delete(params.slug);
	await revalidatePath(`/blog/${params.slug}`);
});
```

A server error, a timeout (408) or a rate limit (429) says nothing about
the page, so the previous copy stays.

## `revalidateAll()`

Re-renders every pre-rendered page and resolves to
`{ revalidated: string[], removed: string[], failed: string[] }`. A route
in `removed` is no longer a page and had its file deleted; one in `failed`
keeps its previous page.

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

- **Only paths `static.routes` covers.** `revalidatePath` creates a page
  for a path the config lists or a pattern matches, and for nothing else.
- **A page created after the build is lost on a redeploy** until it is
  created again, unless the next build's `entries()` names it.
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

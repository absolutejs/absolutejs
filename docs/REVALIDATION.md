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

### A whole folder

A path ending in `/*` stands for every file route in that folder: its own
index, each static route below it as it is, and each dynamic one through
its `entries()`.

```ts
static: { routes: ['/', '/blog/*'] }
```

A route added to the folder later is covered without the config changing.
`'/*'` is every file route in the project.

A dynamic route in the folder that cannot be enumerated is reported under
its own path, the same way a pattern is. A folder selects file routes
only; routes registered in `server.ts` are not part of one.

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

`:name` covers exactly one path segment and `:name?` one or none.
`/docs/*` covers `/docs` and everything below it, which is how to cover a
catch-all route: the catch-all's own name (`/docs/:rest`) is one segment
here.

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

## Tags: `cacheTag` and `revalidateTag`

`revalidatePath` needs the code making a change to know every URL it
shows up on. Editing a post touches its own page, the blog index and the
home page's "latest" list, and the one the handler forgets stays stale.
Tags turn that round: a page says what data it shows, and a change says
what data it touched.

```ts
import { cacheTag, defineLoader, revalidateTag } from '@absolutejs/absolute';

// where the data is READ
export const posts = defineLoader(async () => {
	cacheTag('posts');
	return db.posts.all();
});

export const post = defineLoader(async (slug: string) => {
	cacheTag(`post:${slug}`);
	return db.posts.find(slug);
});

// where it is CHANGED
app.post('/admin/posts/:slug', async ({ body, params }) => {
	await db.posts.update(params.slug, body);
	await revalidateTag('posts', `post:${params.slug}`);
});
```

Every pre-rendered page that used one of those loaders is re-rendered.
The handler names no page.

- **`cacheTag(...tags)`** marks the page being rendered. Call it beside
  the read, from a loader, a route's `load`, a handler or anything they
  call. It does nothing outside a request and on a page that is not
  pre-rendered, so a loader can call it unconditionally.
- **`revalidateTag(...tags)`** re-renders every pre-rendered page
  carrying any of the tags, and resolves like `revalidateAll()`:
  `{ revalidated, removed, failed }`. A tag no page carries resolves to
  three empty lists; it is not an error.

### Tag the list as well as the item

A page is tagged with what it read **when it was rendered**. A home page
that listed posts 1 to 5 knows nothing of post 6, so
`revalidateTag('post:6')` does not reach it. Give anything that lists
things a tag for the collection (`posts`) and revalidate that when one is
added or removed.

### Where tags are kept, and who sees them

The tags a render declared are stored in a `.tags` file beside the
page's HTML, and read from there each time `revalidateTag` is called.
Clustered workers therefore agree on them, and a new build re-renders
every page and records its tags afresh.

A page that streams may call `cacheTag` after its response has started;
the tag is still recorded, because a pre-render reads the whole page
before it stores anything.

Tags are sent only to the pre-renderer: the build's own pre-render
server, and the running server re-rendering its own pages. They are
never in a response to a visitor.

## Where the pages are kept: `static.directory`

By default the server serves and re-renders the pages in the build's own
`_prerendered/` folder. Set `static.directory` to keep them somewhere
else:

```ts
static: {
	routes: ['/', '/blog/*'],
	directory: '/var/lib/myapp/pages'
}
```

Two reasons to:

- **The build directory cannot be written**, as in a read-only image or a
  locked-down container. Point it at any writable path.
- **Several machines serve the app.** Point it at a volume they share,
  and a revalidation on one reaches the others: each checks the disk
  before serving, the same way clustered workers do.

It also means a restart keeps what was revalidated since the build.

Each build uses its own folder inside the directory, copied from the
build's pages the first time that build starts. A page names the hashed
assets of the build that rendered it, so pages are never carried from one
build to the next. The folders of the two builds before the current one
are kept, since a rolling deploy leaves the previous build serving from
its own; older ones are removed.

Use an absolute path. A relative one is resolved against the directory
the server is started from.

**Set it per machine with `ABSOLUTE_STATIC_DIRECTORY`.** A production
server does not read `absolute.config.ts`; it reads what the build wrote
down from it. So `directory: process.env.PAGES_DIR` in the config is
whatever that variable was on the machine that built the app, fixed into
a prebuilt directory or a compiled binary. The environment variable is
read when the server starts and wins over the config.

### When the directory cannot be written

A re-render that cannot write its page used to fail without a word. The
server now checks at startup and logs it:

- if pages cannot be updated where they are, it says so, and says that
  `revalidatePath`, `revalidateTag` and `static.revalidate` will leave
  every page as it is;
- if `static.directory` cannot be created or filled at all, it says so
  and serves the build's own pages instead.

Either way the server starts and serves what it has.

## From outside the app: the revalidation endpoint

`revalidatePath` and `revalidateTag` are functions, so only code in the
server can call them. For a CMS webhook, a job or another service, set a
token and the server accepts requests:

```sh
ABSOLUTE_REVALIDATE_TOKEN="$(openssl rand -hex 32)"
```

```sh
curl -X POST https://example.com/__absolute/revalidate \
  -H "Authorization: Bearer $REVALIDATE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "tags": ["posts"], "paths": ["/blog/hello"] }'
```

```json
{ "revalidated": ["/blog", "/blog/hello"], "removed": [], "failed": [], "skipped": [] }
```

The body takes any of:

| Field | Meaning |
| --- | --- |
| `paths` | Paths to revalidate, as `revalidatePath` would. |
| `tags` | Tags to revalidate, as `revalidateTag` would. |
| `all` | `true` to revalidate every pre-rendered page. |
| `background` | `true` to answer `202` at once and do the work afterwards. |

Use `background` for a caller that will not wait: a CMS typically gives a
webhook a few seconds, and re-rendering many pages can take longer. A
failure then has nobody to report to, so it is logged.

`skipped` lists paths that were asked for and are not ones `static.routes`
covers. Nothing is rendered for them.

### What protects it

It is a public URL that makes the server render pages.

- **Off unless a token is set.** Without one the path is not
  a route. An empty token, or one shorter than 16 characters, counts as
  not set, and the short one is reported at startup.
- **Bearer token, compared in constant time.** A wrong or missing token
  is a `401` whatever the body says.
- **Bounded.** One call may name at most 100 paths and tags.
- **No more than the functions can do.** A path the config does not cover
  is skipped, so the token is permission to say a page is stale, not to
  pre-render any URL.
- **Rate limited** like any other route, when the app configures
  `rateLimit`.

### Where the token comes from

**Set `ABSOLUTE_REVALIDATE_TOKEN` in the server's environment.** It is
read when the server starts and wins over the config.

`static.revalidateToken` in the config works when the app is built and
started in one step with `absolute start`, which hands the value to the
server it launches. It does not reach a server started from an existing
build (`absolute start --prebuilt`) or a compiled binary, because the
token is never written into build output: a secret has no business in a
build folder, an image made from it, or a binary. A server built with a
token and started without one says so at startup, and has no endpoint.

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
- **One directory.** The call re-renders through the server it runs in
  and rewrites the pages in that server's directory. Machines that do not
  share one each hold their own copy: see `static.directory` below.
- **Clustered workers agree through the disk.** Workers of one clustered
  server share the directory, and each checks it before serving: a page
  one worker took down is rendered by the others rather than served, and
  a page one worker created is served by the others once they are asked
  for it. For the length of a rename, another worker can still read one
  page's files from two different renders. `revalidateAll()` covers the
  pages the worker it runs in knows about, which may not yet include one
  another worker created.
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

# Middleware

AbsoluteJS has no `middleware.ts`. Code that runs before a request reaches
a page lives in one of four places, and which one depends on how much of the
app it should cover.

| It should cover                | Put it in                                             |
| ------------------------------ | ----------------------------------------------------- |
| Every request                  | A hook in `server.ts`, before the routes              |
| A set of routes in `server.ts` | `guard()` around those routes                         |
| A folder of file routes        | `layout.server.ts` in that folder                     |
| One file route                 | `beforeHandle` in that route's `<route>.server.ts`    |

Several things people reach for middleware to do are config instead, and
need no code at all: see [Config, not code](#config-not-code).

## Every request: a hook in `server.ts`

`server.ts` is an Elysia app, and Elysia's hooks are its middleware. A hook
applies to the routes registered after it.

```ts
import { Elysia } from 'elysia';
import { prepare, networking } from '@absolutejs/absolute';

const { absolutejs, manifest } = await prepare();

new Elysia()
	.use(absolutejs)
	// Runs before every route below. Returning a value answers the
	// request; returning nothing lets it through.
	.onBeforeHandle(({ request }) => {
		if (request.headers.get('x-api-version') === '1')
			return new Response('This API version is retired.', { status: 410 });
	})
	.get('/', () => 'home')
	.use(networking);
```

Two hooks cover almost everything:

- **`onRequest`** runs first, before the route is even looked up. Use it for
  what must happen for a path nothing serves: answering a CORS preflight,
  refusing a client outright.
- **`onBeforeHandle`** runs once the route is known, with its params and
  parsed query. Use it for anything about the request's content: who is
  asking, and whether they may.

To make a value available to every route, derive it once:

```ts
new Elysia()
	.use(absolutejs)
	.derive(({ request }) => ({ session: sessionFrom(request) }))
	.get('/account', ({ session }) => (session ? 'signed in' : 'anonymous'));
```

`@absolutejs/auth` does this for you: mounting it derives the session onto
every request.

### Example: a CORS preflight

```ts
const ALLOWED_ORIGIN = 'https://app.example.com';

new Elysia()
	.use(absolutejs)
	.onRequest(({ request, set }) => {
		set.headers['access-control-allow-origin'] = ALLOWED_ORIGIN;
		if (request.method !== 'OPTIONS') return undefined;

		return new Response(null, {
			headers: {
				'access-control-allow-headers': 'content-type, authorization',
				'access-control-allow-methods': 'GET, POST, PUT, DELETE',
				'access-control-allow-origin': ALLOWED_ORIGIN
			},
			status: 204
		});
	});
```

## A set of routes: `guard()`

`guard()` applies a hook to the routes inside it and nothing else.

```ts
new Elysia()
	.use(absolutejs)
	.derive(({ request }) => ({ session: sessionFrom(request) }))
	.get('/', () => 'home')
	.guard(
		{
			beforeHandle: ({ session, redirect }) =>
				session ? undefined : redirect('/login')
		},
		(admin) =>
			admin
				.get('/admin', () => 'dashboard')
				.get('/admin/users', () => 'users')
	);
```

## A folder of file routes: `layout.server.ts`

File routes are registered for you, so there is no place in `server.ts` to
wrap `guard()` around a folder of them. Put a `layout.server.ts` in the
folder instead:

```ts
// react/routes/admin/layout.server.ts
import type { FileRouteContext } from '@absolutejs/absolute';

export const beforeHandle = ({ session, redirect }: FileRouteContext) =>
	session ? undefined : redirect('/login');
```

It runs for every route in `admin/` and in every folder below it. A route
added there later is guarded without anyone remembering to guard it, which
is the reason to prefer this over repeating the check in each route.

- **Order.** Guards run outermost folder first, then the route's own
  `beforeHandle`, then its `load`. The first to return a value answers the
  request and nothing after it runs. So an inner guard may rely on what an
  outer one checked.
- **Groups.** It is found the way a layout is: `(members)/layout.server.ts`
  guards every route in the group without adding a segment to their URLs.
- **No layout needed.** It does not need a `layout.tsx` beside it, and every
  framework's route folder may have one, HTML and HTMX included.
- **Context.** The same `FileRouteContext` a route gets: `headers`, `query`,
  `params`, `request`, `set`, `redirect`, and whatever the plugins mounted
  before `fileRoutes()` derived (the `session` above — declare its type
  once on `FileRouteDerivedContext`, as described in
  [FILE_ROUTER_PLAN.md](./FILE_ROUTER_PLAN.md)). `params` are untyped,
  since one guard serves routes with different ones.
- **Only `beforeHandle`.** A `load` exported from it is never called, and
  the route scan reports it. Load a route's data in the route's own server
  module.

A guard for the whole app is `routes/layout.server.ts`.

## One file route: `beforeHandle`

```ts
// react/routes/blog/[slug].server.ts
import type { FileRouteContext } from '@absolutejs/absolute';

export const beforeHandle = ({ params, redirect }: FileRouteContext<'/blog/:slug'>) =>
	params.slug === 'draft' ? redirect('/blog') : undefined;
```

Here `params` is typed from the route's path.

## Config, not code

These are done by the framework from `absolute.config.ts`. Writing them as
middleware works, but it is code to maintain for something already built.

| Need                                   | Config                                                    |
| -------------------------------------- | --------------------------------------------------------- |
| Send an old URL to a new one           | `redirects` — [ROUTING_RULES.md](./ROUTING_RULES.md)      |
| Serve one URL from another's route     | `rewrites` — [ROUTING_RULES.md](./ROUTING_RULES.md)       |
| Response headers for a set of paths    | `headers` — [ROUTING_RULES.md](./ROUTING_RULES.md)        |
| Limit requests per client              | `rateLimit`                                               |
| Access log                             | `logging`                                                 |
| The real host and scheme behind a proxy | `trustProxy` — [TRUST_PROXY.md](./TRUST_PROXY.md)        |

Security headers and a Content-Security-Policy with per-request nonces are
a plugin rather than a config key, because they are opt-in:

```ts
import { secureHeaders } from '@absolutejs/absolute';

new Elysia().use(secureHeaders()).use(absolutejs);
```

## What runs when

For one request, in order:

1. `onRequest` hooks, in the order they were registered. The framework's
   own are registered where you `.use(absolutejs)`: the access log, the
   rate limit, then `redirects` and `rewrites`. Yours run before or after
   them according to which side of that line you wrote them on.
2. A redirect, a rewrite or a rate-limit refusal answers here, and nothing
   below runs.
3. The route is matched. Your `derive` and `onBeforeHandle` hooks run, then
   any `guard()` around the route.
4. For a file route: each `layout.server.ts` from the outermost folder in,
   then the route's own `beforeHandle`, then `load`.
5. The page renders.

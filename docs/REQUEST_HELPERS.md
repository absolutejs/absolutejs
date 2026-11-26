# `headers()` and `cookies()`

Read the current request, and set cookies on its response, from anywhere —
without passing the request down to get there.

```ts
import { cookies, headers } from '@absolutejs/absolute';

export const preferences = () => ({
	language: headers().get('accept-language'),
	theme: cookies().get('theme') ?? 'light'
});

export const rememberTheme = (theme: string) => {
	cookies().set('theme', theme, { maxAge: 60 * 60 * 24 * 365 });
};
```

Neither function takes the request. They read the one the framework is
handling, so they work in a route handler and in anything it calls: a data
loader, a guard, a `layout.server.ts`, a helper module, a component as it
renders on the server.

They need the plugin `prepare()` returns to be mounted, which every
AbsoluteJS app does (`.use(absolutejs)`).

## `headers()`

The request's headers, for reading: `get`, `has`, `entries`, `keys`,
`values`, `forEach`, and iteration.

```ts
const isHtmx = headers().get('hx-request') === 'true';
```

To set a response header, use the route's `set.headers`, or the
[`headers` config key](./ROUTING_RULES.md) for a set of paths.

## `cookies()`

| Method                          | Does                                              |
| ------------------------------- | ------------------------------------------------- |
| `get(name)`                     | The cookie's value, or `undefined`                |
| `has(name)`                     | Whether the cookie is present                     |
| `getAll()`                      | Every cookie, as an object                        |
| `set(name, value, options?)`    | Send the cookie with the response                 |
| `delete(name, options?)`        | Expire the cookie                                 |

A read later in the same request sees a write made earlier in it: after
`set('theme', 'dark')`, `get('theme')` is `'dark'`, and after `delete` it
is `undefined`.

Values are percent-encoded on the way out and decoded on the way in, so any
string is safe as a value.

### Options

| Option        | Default                                   |
| ------------- | ----------------------------------------- |
| `path`        | `/`                                       |
| `httpOnly`    | `true`                                    |
| `sameSite`    | `'lax'`                                   |
| `secure`      | Whether the request arrived over HTTPS    |
| `maxAge`      | none: the cookie lasts the browser session |
| `expires`     | none                                      |
| `domain`      | none: the host that set it                |
| `partitioned` | `false`                                   |

The defaults lean safe on purpose. Turn `httpOnly` off only for a cookie
the page's JavaScript has to read. `secure` follows the request, including
behind a proxy that reports HTTPS, so the same code works on `localhost`
and in production.

`maxAge` is in seconds, and wins over `expires` if both are given.

To delete a cookie that was set with a `path` or `domain`, pass the same
ones: a browser treats the name, domain and path together as the cookie.

### What is refused

These throw where the cookie is set, rather than sending something a
browser will drop:

- a name that is not a valid cookie name (spaces, `=`, `;`, or empty);
- a `path` or `domain` containing `;` or a line break;
- `sameSite: 'none'` without `secure`, which browsers reject outright;
- a `maxAge` that is not a number.

## When a cookie can still be set

A cookie is sent in the response's headers, so it has to be set before the
response starts. In practice:

- **Route handlers, guards, `beforeHandle`, `load`:** always fine.
- **A component rendering on the server:** fine while the page's first
  part renders. A component that streams in later — behind a suspense
  boundary or a streaming slot — renders after the headers have gone.

Setting a cookie too late throws, with a message saying so. It does not
fail silently.

A cookie set before a guard refuses the request, before a redirect, or
before the handler throws is still sent with that response.

## Outside a request

Both functions throw if there is no request: at module scope, in a timer,
or in code that runs after the response. The message says where they do
work.

## Sessions

There is no `session()` here, deliberately. Sessions belong to
[`@absolutejs/auth`](https://github.com/absolutejs/absolute-auth): it keeps
them on the server behind an opaque cookie, with in-memory, Redis and
Postgres stores, and it has guest sessions for state that exists before
sign-up — a cart, a trial — which become the signed-in session at login.

For something small that is not a session, a cookie is enough:

```ts
cookies().set('banner-dismissed', '1', { maxAge: 60 * 60 * 24 * 30 });
```

A cookie is readable by the visitor and limited to about 4 KB. Anything
private, or anything that grows, belongs in a session.

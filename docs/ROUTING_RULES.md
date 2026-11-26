# Redirects, rewrites and headers

Three keys in `absolute.config.ts` for the things a site needs that are not
pages: an old URL that should lead to a new one, a short URL that should be
served by a longer one, and response headers for a set of paths.

```ts
import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	redirects: [
		{ from: '/old-pricing', to: '/plans/pricing' },
		{ from: '/blog/:slug', to: '/posts/:slug', status: 301 },
		{ from: '/docs/*', to: 'https://docs.example.com/*' }
	],
	rewrites: [{ from: '/p/:id', to: '/products/:id' }],
	headers: [
		{ path: '/*', headers: { 'x-frame-options': 'DENY' } },
		{
			path: '/downloads/*',
			headers: { 'cache-control': 'public, max-age=3600' }
		}
	]
});
```

They are applied by the running server, in `absolute dev` and
`absolute start` alike, to an app that mounts the plugin `prepare()`
returns. No code in `server.ts` is needed.

## Patterns

The pattern language is the file router's.

| Written    | Matches                                                        |
| ---------- | -------------------------------------------------------------- |
| `/pricing` | That path. A trailing slash on the request is ignored.         |
| `/blog/:slug` | Exactly one segment in that position, captured as `slug`.   |
| `/docs/*`  | `/docs` and everything under it. `*` must be the last segment. |

A destination may use the names its pattern captured, and `*` for what the
pattern's `*` matched. Captured values are carried across exactly as they
arrived, still percent-encoded.

There are no regular expressions and no optional segments. Write two rules.

## Redirects

`{ from, to, status? }`. The first rule that matches answers, before any
route is looked up — so a redirect works for a path nothing serves, which is
usually why it exists.

- `status` defaults to **308**: permanent, and a `POST` stays a `POST`. Use
  301 or 302 if you want browsers to turn it into a `GET`, 307 for a
  temporary redirect that keeps the method. Any other number is refused.
- `to` may be a path or a full `https://` URL.
- The request's query string follows the redirect (`/old?ref=mail` lands on
  `/new?ref=mail`), unless `to` has a query string of its own.

## Rewrites

`{ from, to }`. The request is served by the route at `to`; the address in
the browser does not change. Method, headers and body are carried. Checked
after redirects.

- `to` must be a path of this app. A rewrite cannot serve another site; use
  a redirect, or fetch the other site from a route.
- A rewritten request is not redirected or rewritten again at its
  destination. A rewrite to `/b` does not follow a redirect from `/b`, which
  would reveal the address the rewrite was hiding.
- A rewrite to a path nothing serves is a 404.
- A rewritten request passes the rate limiter twice, once at each address.

## Headers

`{ path, headers }`. Every rule whose `path` matches applies, in order, and a
later rule overrides an earlier one for the same header. Rules are matched
against the path the visitor asked for, including when it is rewritten.

A rule is a **default for the paths it names**: a route that sets the same
header itself, or returns a `Response` carrying it, keeps its own value.

The exception is files the framework serves from the build directory —
your assets, bundles and stylesheets. Their `cache-control` comes from the
framework's file server, not from a decision about your app, so there a
rule wins. That is what makes this work:

```ts
headers: [
	{ path: '/assets/*', headers: { 'cache-control': 'public, max-age=86400' } }
];
```

Leave hashed bundles alone: the framework already serves them
`immutable`, and a rule that shortens that makes every visit slower.

## What is checked at startup

A rule that is wrong stops the server from starting, with every problem
listed:

- a pattern that does not start with `/`, uses `*` anywhere but last, or
  uses a `:name` twice;
- a destination that uses a `:name` or `*` its pattern does not capture;
- a rewrite to another site;
- a status that is not 301, 302, 303, 307 or 308;
- a header name that is not valid, or a value with a line break in it;
- a rule that can never match because an earlier one has the same pattern;
- redirects that lead back to where they started (`/a` to `/b` to `/a`).

## The framework's own paths

Paths under `/__absolute/` and `/_absolute/` — health checks, web vitals,
the image endpoint, dev tooling — are never redirected or rewritten, so a
`/*` rule cannot take them with it. Header rules do reach them.

## Static export

`absolute export` produces a directory for a static host, which runs no
server to apply any of this. The rules are written into two files instead:

- `_redirects`: each redirect, and each rewrite as a status-200 rule;
- `_headers`: each header rule.

Netlify and Cloudflare Pages read both. S3 and GitHub Pages do not, and the
rules do not exist there; configure them on the host.

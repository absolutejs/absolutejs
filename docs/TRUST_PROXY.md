# Behind a proxy

A server behind a load balancer, a CDN or nginx does not see the request the
browser made. It sees the proxy's: often plain HTTP, sometimes addressed to
an internal host name, always from the proxy's address. The proxy says what
the original was in forwarded headers, and the question is which of them to
believe.

```ts
// absolute.config.ts
export default defineConfig({ trustProxy: true });
```

## What needs the setting, and what does not

| What                | Header                                | Believed                     |
| ------------------- | ------------------------------------- | ---------------------------- |
| The original scheme | `x-forwarded-proto`, `Forwarded`      | Always                       |
| The original host   | `x-forwarded-host`, `Forwarded`       | Only with `trustProxy`       |
| The client address  | `x-forwarded-for`                     | Only with `trustProxy`       |

**The scheme needs no setting.** It is used to mark cookies `Secure`, to
send HSTS and to write `https://` in absolute links. A client that lies
about it marks its own cookies `Secure`, which harms nobody. So the common
deployment — a platform that terminates TLS and passes `Host` through —
works with nothing configured.

**The host and the address do.** A forwarded host goes into absolute URLs in
the page, and a forwarded address is the key rate limiting counts by. On a
server clients reach directly those headers are the client's to choose: it
would pick where the page's links point, or get a fresh rate limit with
every request. `trustProxy` says a proxy you control sets them.

## What it changes

- **i18n's domain strategy** matches the host the browser asked for, not
  the upstream name the proxy forwarded to.
- **hreflang links** are built from that host.
- **The form-action CSRF check**, when the browser sends no
  `Sec-Fetch-Site`, compares `Origin` with that host. Without the setting,
  behind a proxy that rewrites `Host`, the comparison fails closed and the
  post is refused.
- **Rate limiting** counts the forwarded client address.
  `rateLimit.trustProxy` still overrides it either way.

## Setting it

`trustProxy: true` in the config, or `ABSOLUTE_TRUST_PROXY=1` in the
environment, which wins. Leave it off for a server that terminates TLS
itself (see [PRODUCTION_TLS.md](./PRODUCTION_TLS.md)) or that anything can
reach without going through the proxy.

It is one switch, not a list of trusted addresses or a hop count. The first
value of each header is taken as the client's. That is right when your
proxy overwrites these headers, or appends to a chain it started; it is
wrong if the proxy passes through whatever a client sent. Check that yours
overwrites `x-forwarded-host` and `x-forwarded-for`.

A forwarded host that is not a plain host name, with an optional port, is
ignored even when trusted.

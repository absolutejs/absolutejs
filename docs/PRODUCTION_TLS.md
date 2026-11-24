# Production TLS and HTTP/2

A production server can terminate HTTPS itself, and serve HTTP/2 over it.

```ts
// absolute.config.ts
export default defineConfig({
	tls: {
		cert: '/etc/ssl/site/fullchain.pem',
		key: '/etc/ssl/site/privkey.pem'
	}
});
```

That is the whole setup. `absolute start`, `bun server.js` and a compiled
binary all listen on HTTPS with it, and a client that asks for HTTP/2 gets
it; one that does not gets HTTP/1.1 on the same port.

## Do you need it?

Not behind something that already terminates TLS — a load balancer, a CDN,
nginx, Caddy, a platform's router. There the app should keep listening on
plain HTTP, and `tls` should stay unset.

It is for the server that faces the network itself: one machine with no
other use for a proxy, an internal service that must be encrypted end to
end, a compiled binary handed to someone to run.

## Settings

| Config      | Environment               | What                                                        |
| ----------- | ------------------------- | ----------------------------------------------------------- |
| `tls.cert`  | `ABSOLUTE_TLS_CERT`       | Path to the PEM certificate, intermediates after it         |
| `tls.key`   | `ABSOLUTE_TLS_KEY`        | Path to the PEM private key for that certificate            |
| `tls.ca`    | `ABSOLUTE_TLS_CA`         | Path to a CA bundle, for a private CA                       |
| `tls.http2` | `ABSOLUTE_TLS_HTTP2`      | `false` turns HTTP/2 off; HTTPS stays                       |
| —           | `ABSOLUTE_TLS_PASSPHRASE` | Passphrase for an encrypted key. Environment only           |

The environment wins over the config, so one build can run with a different
certificate in each place it is deployed, and the environment alone is
enough — a project does not need `tls` in its config to use it.

The config holds paths, never contents. The built config
(`absolute-runtime.json`) carries the same paths and nothing else; the
files are read when the server starts. A relative path is resolved from the
directory the server is started in, so prefer absolute ones.

## It fails rather than falls back

A server asked for HTTPS that cannot do it does not start. It does not
start on plain HTTP instead: that server would look healthy and be serving
in the clear. Each of these stops it, with the reason and the path:

- a certificate configured without a key, or a key without a certificate
- a file that is missing or unreadable
- a file that is not a certificate, or not a private key
- a key that does not belong to the certificate
- a wrong or missing passphrase

An expired certificate, or one within 14 days of expiring, is a warning at
startup and not a failure: the server may be the thing a renewal is waiting
on.

## Renewing a certificate

**A renewed certificate is picked up when the server restarts.** Bun does
not swap the certificate of a listening server (measured on 1.4.4:
`server.reload()` with a new certificate keeps serving the old one), so
there is no reload signal to send.

With `shutdown` draining (on by default) a restart finishes in-flight
requests first. Point `tls.cert` and `tls.key` at the stable paths a
renewal tool rewrites in place — for certbot, the `live/<domain>/` symlinks
— and restart from its deploy hook.

## What it does not do

- **Redirect HTTP to HTTPS.** The server listens on one port. Something
  else has to answer port 80 if plain-HTTP visitors should be sent on.
- **Set HSTS.** That is `secureHeaders({ hsts: true })`, and it is only
  sent on requests that arrived over HTTPS.
- **Obtain certificates.** Use certbot, acme.sh or the platform's own.
- **HTTP/2 without TLS (h2c).** Bun can serve it; nothing here turns it on.
- **Bind port 443 for you.** Binding below 1024 needs the usual privilege
  (`CAP_NET_BIND_SERVICE`, or a port mapping in front).

## Development is separate

`dev: { https: true }` and its local certificate are unchanged, and `tls`
is ignored under `absolute dev`. So is the server the build runs for a
moment to render static pages: it stays on plain HTTP on localhost, which
is how the build fetches from it.

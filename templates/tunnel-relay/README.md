# AbsoluteJS tunnel relay

A tiny, self-hosted public relay that lets a local `bun run dev` receive
webhooks and WebSockets (Twilio, Stripe, OAuth callbacks) **without deploying**.
Pure Bun, zero third-party tunnel services — you run your own relay.

```
Internet ──HTTPS/WSS──▶  relay (this app, public)  ──control WS──▶  your laptop (bun run dev)
```

## 1. Deploy the relay (DigitalOcean App Platform)

1. Put this folder in its own git repo (App Platform deploys from a repo + Dockerfile).
2. Pick a long random secret for `ABSOLUTE_TUNNEL_TOKEN` (e.g. `openssl rand -hex 32`).
3. Create the app from `.do/app.yaml` (`doctl apps create --spec .do/app.yaml`)
   or via the DO UI (Docker source, port 8080, set the env vars).
4. After the first deploy DO assigns a URL like
   `https://absolute-tunnel-relay-xxxxx.ondigitalocean.app` — set that as
   `ABSOLUTE_TUNNEL_PUBLIC_URL` and redeploy. (Add a custom domain like
   `tunnel.yourdomain.com` later if you want.)

## 2. Point your app's dev server at it

In the consuming app's `absolute.config.ts`:

```ts
export default defineConfig({
  dev: {
    tunnel: {
      relay: 'https://absolute-tunnel-relay-xxxxx.ondigitalocean.app',
      token: process.env.ABSOLUTE_TUNNEL_TOKEN // same secret as the relay
    }
  }
});
```

Now `bun run dev` prints a `Public:` line — that public URL routes straight to
your local server. Use it for your webhook provider's callback URLs.

> The relay is single-tenant per token: one dev machine at a time. Give each
> developer their own relay app (or token) if you need several.

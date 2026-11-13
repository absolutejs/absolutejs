# AbsoluteJS container for scale-to-zero platforms

A Dockerfile that runs an AbsoluteJS app on platforms that start a container
per request burst and stop it when idle: Cloud Run, Fly Machines with
auto-stop, Railway, Render, Knative, ECS/Fargate. AbsoluteJS does not run on
Cloudflare Workers, Vercel Edge or Deno Deploy; see
`docs/SERVERLESS_TARGETS_PLAN.md` in the framework repo for why.

## Use it

Copy `Dockerfile` and `.dockerignore` into your app root (next to
`package.json`), commit `bun.lock`, then:

```sh
docker build -t my-app .
docker run --rm -p 3000:3000 my-app
```

The platform sets `PORT`; the image defaults it to 3000.

## Two targets

|                                     | `server` (default)                       | `binary` (`--target binary`)                                          |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| Runs                                | `bun dist/server.js` over `node_modules` | the `absolute compile` executable                                     |
| Image size (`docker image inspect`) | 134 MB                                   | 156 MB                                                                |
| Container start to first byte       | 550 ms                                   | 160 ms                                                                |
| First server-rendered response      | ready with the first byte                | about 210 ms more: it unpacks its runtime (about 80 MB) into `TMPDIR` |
| Memory after one request per page   | 90 MiB                                   | 156 MiB, including the unpacked runtime on a tmpfs `/tmp`             |
| Pre-rendered pages                  | only with `static` in the config         | every page `absolute compile` can pre-render                          |

Measured 2026-11-12 with a create-absolutejs app (React, Svelte, Vue, HTML,
HTMX), Bun 1.4.4, Docker Desktop 29.2 on an Apple Silicon Mac (linux/arm64),
`--read-only --tmpfs /tmp`, median of 5 `docker run -d` to the first `200`.
A platform adds its own scheduling and image pull time on top.

Pick `binary` when the first byte matters most and most pages pre-render.
Pick `server` for the smaller memory footprint and when most requests are
server-rendered.

## What the image assumes

- **Built inside Linux.** The build runs in the image, not on your machine.
  The server bundle can carry native addons for the platform it was built on,
  so a `dist/` from macOS does not run in a Linux container.
- **Read-only friendly.** Both targets run with `--read-only` and a writable
  `/tmp`. The `server` target writes nothing at all; `binary` writes its
  unpacked runtime and the client asset record under `/tmp`.
- **Image optimizer cache.** `/_absolute/image` works, but its cache lives in
  `dist/.cache/images`, which the non-root `bun` user cannot write, so every
  optimized image is re-encoded. Set `images.cacheDirectory` in
  `absolute.config.ts` to a writable path (a volume, or `/tmp/images` for a
  per-instance cache) to keep them.
- **Incremental static regeneration** (`static.revalidate`) rewrites pages
  in `dist/_prerendered`, which the `server` target cannot write; pages are
  served as built. On scale-to-zero every instance starts from the image
  anyway, so regenerate by redeploying.
- **WebSockets** work while an instance is up, but platforms that scale to
  zero cap request duration and stop idle instances, so long-lived sockets
  are dropped on scale-in.
- **Run the bundle, not the CLI.** `absolute start --prebuilt` starts a
  controller process that spawns `bun dist/server.js`; running the bundle
  directly saved about 300 ms of cold start in the measurement above. The
  `ENV` block in the Dockerfile carries what `start` would have set.

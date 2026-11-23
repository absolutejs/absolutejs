# Static export

`absolute export` builds the project, pre-renders its pages and assembles a
directory to upload to S3, Netlify, Cloudflare Pages or GitHub Pages.

```bash
absolute export                          # ./out
absolute export example/server.ts --to public
absolute export --flat                   # about.html, not about/index.html
absolute export --precompressed          # keep the .br and .gz siblings
absolute export --json                   # the plan, for a pipeline
```

## Why this is not "copy the build directory"

The build directory is mostly not public. Measured against the example
app's own production build:

| | files | bytes |
| --- | --- | --- |
| public | 248 | 5.86 MB |
| server-only | 95 | 21.50 MB |
| total | 343 | 27.36 MB |

**79% of it is server-only** — the bundled server (3.69 MB), its source map
(8.09 MB), the SSR page bundles, the runtime manifests and a 2.77 MB
`tailwindcss-oxide` native binary built for one platform.

In production none of that reaches a client, because `absolute start`
mounts the directory behind the ignore patterns in
`src/core/serverOnlyStaticFiles.ts`. Probing a running server:

```
404 /server.js          404 /manifest.json
404 /server.js.map      404 /tailwindcss-oxide.darwin-arm64-….node
```

**That protection belongs to the running server.** A static host applies no
patterns, so copying the same directory republishes every one of those
files and `GET /server.js` downloads the backend. The export applies the
same classification with the same code, and the exported tree is 4.5 MB.

## What it writes

- Every public build file, at the path it already has.
- Each pre-rendered route as HTML: `/about` → `about/index.html`
  (`--flat` writes `about.html` instead).
- `.nojekyll`, always — see below.

It reports what it left out and why: server-only files, the `_prerendered/`
sources it placed at their routes instead, pre-compressed siblings, and any
build file a route overwrote.

### `.nojekyll` is not optional

GitHub Pages runs Jekyll, which skips every path whose name begins with `.`
or `_`. A React page loads its hydration index from
`/.absolutejs/generated/react/indexes/…`, so without this file the page is
served and silently never hydrates — a failure that looks like a framework
bug and is a host default. One empty file prevents it, so it is written
unconditionally rather than behind a flag nobody would know to pass.

### Layout, and which hosts need which

`directory` (the default) works everywhere, including a plain S3 website
bucket. `--flat` is shorter and fine on hosts that try adding `.html`
themselves (GitHub Pages, Netlify), and 404s on S3.

## What cannot be exported

A static host runs no server, so none of this survives: API routes, form
actions, anything that reads a request, and ISR — `static.revalidate` needs
a process to re-render stale pages, and the export says so when it is set.

Routes come from `config.static.routes`, or from crawling the links
reachable from `/`. **A page nothing links to is invisible to a crawl**, so
list routes explicitly when it matters. A crawl that finds nothing is now
an error rather than an export with no pages.

## Verifying an export

Serve the directory with a host that does nothing but return the file or
its directory index — the weakest case — and check that every asset each
page references answers 200. Against the example app: 7 pages, 32 asset
references, 0 broken, and `/server.js`, `/server.js.map`,
`/manifest.json`, `/build-outputs.json` and `/_prerendered/react.html` all
absent.

## Two things this work fixed on the way

**Build traces were public.** `ABSOLUTE_BUILD_TRACE` writes
`.absolute-trace/build-trace-<stamp>.json` into the build directory, and a
production server served it: 200, 11 KB of build phase timings including
the absolute path of every compiled source file — so the developer's
username and project layout. The server never reads those files back, and
they are now withheld like the rest of the server-only set.

**A pre-render against the wrong server looked like success.** The export
first used `PORT + 1`, which collided with an unrelated dev server. The
readiness probe accepts any listener, so the pass ran against the stranger,
the crawl found no HTML, and it reported a successful export of zero pages.
The port now comes from the OS, the readiness poll stops the moment the
spawned server dies (so `EADDRINUSE` surfaces immediately instead of after
the full 30s timeout), and a crawl that finds nothing is a failure.

# Module preloading

A page's response carries a `Link` header naming every module its client
entry will import, so the browser starts fetching them with the HTML
instead of after it.

Nothing to configure.

## What it fixes

A browser discovers a module graph by walking it: fetch the entry, parse
it, find its imports, fetch those, parse them, and so on. Each level is a
round trip that cannot begin until the one above finishes.

Measured on the example app's own build, a React page's hydration entry
statically imports **nine modules** across three levels — the shared
chunk, react, react-dom, react-dom/client, the jsx runtime, and the chunks
those pull in. The page's markup preloaded exactly one of them: the entry
itself.

```
/react  ->  200   Link: 9 preloads
```

## Why a header rather than `<link>` tags

Two reasons, and the second is the one that decided it.

The entry `<script type="module">` is emitted from several places, one per
framework — so markup would mean the same change in each.

More importantly, a **streamed** page has already sent its headers by the
time its markup exists. React's pages stream, and they are the ones with
the deepest graph. A header reaches them; a tag in the head would have to
be written before the head is flushed, which is the one moment the entry
is known but the document is not.

It is also the shape a `103 Early Hints` response carries, so if that ever
becomes available this moves rather than being rewritten.

## 103 Early Hints is not possible here yet

Not for want of trying. `Bun.serve` cannot send one: a `Response` must
have a status of 101 or 200–599, so an informational response is not
expressible at all —

```
new Response(null, { status: 103 })
// TypeError: The status provided (103) must be 101 or in the range of [200, 599]
```

Bun's `node:http` **can** — `response.writeEarlyHints()` puts a real
`HTTP/1.1 103 Early Hints` on the wire, verified over a raw socket. But
that is a different server from the one underneath this framework.

So the header is sent with the response. When `Bun.serve` grows a way to
send an informational response, the same `Link` value moves earlier.

## What gets preloaded

Only what the entry **statically** imports, transitively.

A dynamic `import()` is deliberately not followed: it is code the page has
said it does not need yet, and preloading it would spend the bandwidth
this exists to save.

Nothing outside the build directory is preloaded, whatever a specifier
says, and a specifier that resolves to no file is skipped rather than
failing the build.

The graph is computed at build time into `modulepreload.json`, which is
server-only and never served. It has to be computed then: the bundler's
chunking decides the graph, and a specifier in your source does not say
which chunk it ends up in.

## Pages with no client entry get no header

A static page, or a page that ships no client bundle, has nothing to
preload and so carries no `Link` header. That is the expected result, not
a failure — the example app's Svelte page is exactly this case.

# Compression

What the running server compresses, and what it does not yet.

## Static files

The production build writes a `.br` and a `.gz` beside every compressible
file, and the server sends whichever the browser accepts. Nothing is
compressed at request time.

## Pages

A page rendered in one piece — a static HTML or HTMX page, an Angular page
— is compressed as it is served: brotli, or gzip for a client that does not
accept brotli, with `vary: accept-encoding`. It carries an ETag of its own
for the encoded body, so a repeat visit is still a 304.

```ts
export default defineConfig({
	compression: { pages: false }
});
```

turns that off, for a server behind something that compresses for it.

## Streamed pages (opt-in)

A page rendered as a stream — every React, Svelte and Vue page — is sent as
it was rendered, unless the config asks:

```ts
export default defineConfig({
	compression: { streaming: true }
});
```

It is then compressed as it streams, and flushed after every chunk the page
writes, so the shell leaves when it is rendered and a streamed slot's
content when it resolves. Measured with a slot that takes 600 ms: the first
chunk of the compressed page arrives in under 400 ms, and a 5 KB page is
under 1.5 KB on the wire. Brotli quality is 4 here, not the buffered
compressor's 9, because a stream is compressed in pieces while the visitor
waits on each.

### Why it is off by default

It changes what a page handler returns. With it on, the body of that
response is compressed bytes, and a route that reads the response reads
those bytes as HTML:

```ts
const response = await handleReactPageRequest({ … });

// Broken with streaming compression on: text() is compressed bytes, and
// they are sent on under a content-encoding they no longer match.
return new Response(await response.text(), { headers: response.headers });
```

It was on for everyone for one release (beta.453), and that is what it
broke: the nightly's browser tests for `invalidate()` and for React
hydration recovery, both of which serve a page through a route written
exactly like that. A handler's response is the app's to read, so its body
is not changed unless the app says it never reads one.

Turn it on when no route reads a page handler's response. A route that
does can take the page back first:

```ts
import { uncompressedPage } from '@absolutejs/absolute';

const page = uncompressedPage(await handleReactPageRequest({ … }));
```

The compressed body is made only when something reads it, and until then
`uncompressedPage` returns the page as it was. The framework's own
streaming-slot wrappers (`withStreamingSlots`,
`wrapPageHandlerWithStreamingSlots`) do this already; a response they
produce is sent uncompressed. The server's own requests for a page — for
its Markdown, for `llms-full.txt` — ask for it uncompressed.

With it on, a page is still sent as it was rendered to a client that
accepts neither encoding, when its handler encoded the body itself, for a
request carrying a form result, and for the pre-renderer's own request.

Compressing every streamed page by default needs to happen after the app's
routes have had the response, at the point it leaves the server. That is
not built.

## Pre-rendered pages

A pre-rendered page is a file, and was sent as the file. It is now
compressed the first time it is asked for in an encoding, and that copy is
kept in memory and sent to everyone after: a page is the same for every
visitor until it is rendered again, so the work is done once per page per
encoding, at the buffered compressor's quality.

The copy is kept under the file's size and the time it was last written. It
is not written beside the page on disk: a page is rewritten in several
places — revalidation, a page store filling the directory, another worker —
and a compressed file left beside one of them would be served as the page
after the page had changed. A copy that names the version it was made from
cannot outlive it.

- The kept copies add up to at most 64 MB per server process. Past that the
  oldest go, and are compressed again when next asked for.
- A pre-rendered shell with dynamic parts is streamed, and is compressed as
  it streams, like a page rendered for the request.
- `compression: { pages: false }` turns this off too.

Sent as the file: a page under 1 KB, a `HEAD` request, a page served with
`static.cache` (its validators are for the file as it is; a CDN in front
compresses it), and a page rewritten for the request's CSP nonce under
`secureHeaders()`.

## Not yet

- Streamed pages by default, as above.
- A pre-rendered page under `static.cache` or under a per-request CSP
  nonce, as above.
- An API route's response, and the server's own text responses (a page as
  Markdown, `llms-full.txt`).
- zstd.

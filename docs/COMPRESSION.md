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

## Not yet

- Streamed pages by default, as above.
- A pre-rendered page, which is a file on disk and is sent as it is.
- A pre-rendered shell with dynamic parts, which is streamed by the
  pre-render plugin and not by a page handler.
- An API route's response, and the server's own text responses (a page as
  Markdown, `llms-full.txt`).
- zstd.

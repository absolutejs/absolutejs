# Compression

What the running server compresses, and what it does not yet.

## Static files

The production build writes a `.br` and a `.gz` beside every compressible
file, and the server sends whichever the browser accepts. Nothing is
compressed at request time.

## Pages

A page is compressed as it is served: brotli, or gzip for a client that does
not accept brotli. Always with `vary: accept-encoding`.

- **A page rendered in one piece** (a static HTML or HTMX page, an Angular
  page) is compressed whole, and carries an ETag of its own for the encoded
  body, so a repeat visit is still a 304.
- **A page rendered as a stream** (every React, Svelte and Vue page) is
  compressed as it streams, and flushed after every chunk the page writes.
  The shell leaves when it is rendered and a streamed slot's content when it
  resolves, as before: measured with a slot that takes 600 ms, the first
  chunk arrives in single-digit milliseconds, compressed. The quality is
  lower than for a buffered page (brotli 4, not 9), because a stream is
  compressed in pieces while the visitor waits on each.

Before this, a streamed page was sent as it was rendered. Measured on a
production server asking for `br, gzip`: a 5 KB React page and a 12 KB page
with a streamed slot both left with no `content-encoding`.

A page is sent uncompressed:

- to a client that accepts neither encoding;
- when its handler encoded the body itself;
- for a request carrying a form result, which is written into the page after
  it is rendered;
- for the pre-renderer's own request for a page's shell.

```ts
export default defineConfig({
	compression: { pages: false }
});
```

turns page compression off, for a server behind something that compresses
for it.

### Reading a page inside the server

A page's response is not always finished when its handler returns it. The
streaming-slot wrappers (`withStreamingSlots`,
`wrapPageHandlerWithStreamingSlots`) take a handler's response and append to
its body, and appending HTML to compressed bytes makes a response nothing
can decode. So a streamed page's compressed body is made only when something
reads it, and until then the page can be had back as it was. Those wrappers
do; a response they produce is sent uncompressed.

The server's own requests for a page — for its Markdown, for
`llms-full.txt` — ask for it uncompressed.

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

- A pre-rendered page under `static.cache` or under a per-request CSP
  nonce, as above.
- An API route's response, and the server's own text responses (a page as
  Markdown, `llms-full.txt`).
- zstd.

import { constants, createBrotliCompress, createGzip } from 'node:zlib';

/* Compressing a page that is streamed.
 *
 * A page rendered as a stream — every React, Svelte and Vue page — was
 * sent uncompressed. The compressor for a buffered page
 * (compressHtmlResponse.ts) needs the whole body, and buffering a
 * stream to compress it forfeits the first byte, which is what the
 * stream is for. Measured on a production server: a 5 KB React page and
 * a 12 KB page with a streamed slot both left with no
 * `content-encoding`.
 *
 * This compresses as the page streams, and flushes after every chunk
 * the page writes, so the shell still leaves when it is rendered and a
 * slot's content when it resolves. Measured: a shell written at once
 * and a slot 300 ms later arrive at 7 ms and 302 ms, compressed.
 *
 * The compressed body is made when something first reads it, and until
 * then the page can be had back uncompressed (`uncompressedPage`). That
 * matters because a page's response is not always finished when its
 * handler returns it: the streaming-slot wrappers
 * (responseEnhancers.ts) take a handler's response and append to its
 * body, and appending HTML to compressed bytes makes a response nothing
 * can decode. Whatever inside the server needs a page's HTML takes the
 * page back first. */

export type StreamEncoding = 'br' | 'gzip';

/* Lower than the buffered compressor's 9. A stream is compressed in
 * pieces while the visitor waits on each one, and the gain past this is
 * a few percent for several times the work. */
const BROTLI_STREAM_QUALITY = 4;
const GZIP_STREAM_LEVEL = 6;

type Compressor = ReturnType<typeof createGzip>;

const compressorFor = (encoding: StreamEncoding) =>
	encoding === 'br'
		? createBrotliCompress({
				params: {
					[constants.BROTLI_PARAM_QUALITY]: BROTLI_STREAM_QUALITY
				}
			})
		: createGzip({ level: GZIP_STREAM_LEVEL });

const flushOf = (encoding: StreamEncoding) =>
	encoding === 'br'
		? constants.BROTLI_OPERATION_FLUSH
		: constants.Z_SYNC_FLUSH;

/* Everything written so far, out of the compressor and on its way:
 * without it a chunk waits in the compressor for the next one. */
const flushed = (compressor: Compressor, flag: number) =>
	new Promise<void>((resolve) => {
		compressor.flush(flag, () => resolve());
	});

const pump = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	compressor: Compressor,
	flag: number
): Promise<void> => {
	const { done, value } = await reader.read();
	if (done) {
		compressor.end();

		return;
	}
	compressor.write(value);
	await flushed(compressor, flag);
	await pump(reader, compressor, flag);
};

/** `source`, compressed as it arrives and flushed after each chunk.
 *  Nothing is read from `source` until the result is. */
export const compressStream = (
	source: ReadableStream<Uint8Array>,
	encoding: StreamEncoding
) => {
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let compressor: Compressor | undefined;

	return new ReadableStream<Uint8Array>(
		{
			cancel(reason) {
				compressor?.destroy();

				return reader?.cancel(reason);
			},
			pull(controller) {
				if (reader) return;
				const active = compressorFor(encoding);
				reader = source.getReader();
				compressor = active;
				active.on('data', (chunk: Buffer) =>
					controller.enqueue(new Uint8Array(chunk))
				);
				active.on('end', () => controller.close());
				active.on('error', (error) => controller.error(error));
				pump(reader, active, flushOf(encoding)).catch(
					(error: unknown) => controller.error(error)
				);
			}
		},
		/* Nothing asked for ahead of a reader. A stream otherwise fills
		 * its queue as soon as it is made, which would take `source` at
		 * once: and until this is read, the page has to stay one that
		 * can be had back (`uncompressedPage`). */
		{ highWaterMark: 0 }
	);
};

type Original = { response: Response; taken: boolean };

const originals = new WeakMap<Response, Original>();

/** `response` with its streamed body compressed. The original is kept
 *  until the compressed body is read, for `uncompressedPage`. */
export const compressedPage = (
	response: Response,
	encoding: StreamEncoding
) => {
	if (!response.body) return response;
	const original: Original = { response, taken: false };
	const { body } = response;
	const headers = new Headers(response.headers);
	headers.set('content-encoding', encoding);
	headers.append('vary', 'accept-encoding');
	// It described the body before it was compressed.
	headers.delete('content-length');
	const compressed = new Response(compressStream(body, encoding), {
		headers,
		status: response.status,
		statusText: response.statusText
	});
	originals.set(compressed, original);

	return compressed;
};

/** The page as it was before `compressedPage`, for whatever inside the
 *  server reads or adds to its HTML. Any other response is returned as
 *  it is. */
export const uncompressedPage = (response: Response) => {
	const original = originals.get(response);
	if (!original || original.taken) return response;
	original.taken = true;
	originals.delete(response);

	return original.response;
};

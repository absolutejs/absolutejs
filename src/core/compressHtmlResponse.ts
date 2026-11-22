/* Compressing a page the server just rendered.
 *
 * `createPrecompressedPlugin` writes `.br` and `.gz` beside every
 * compressible file at build time and serves them, which covers static
 * assets. It cannot cover a page handler's response: that HTML is
 * produced per request, and even a static HTML page served through
 * `handleHTMLPageRequest` is read and returned by the handler rather
 * than by the asset plugin, so the `.br` sitting next to it on disk was
 * never reached either.
 *
 * Measured against the example app in production mode, asking for
 * `br, gzip`: every page came back with no `content-encoding`.
 *
 *   react    2670 B → 933 B brotli   (65% off)
 *   svelte   2821 B → 989 B          (65%)
 *   vue      2988 B → 1033 B         (65%)
 *   angular  4045 B → 1474 B         (64%)
 *   html     1731 B → 580 B          (66%)
 *   htmx     6013 B → 1366 B         (77%)
 *
 * Split in two on purpose. Choosing the encoding is cheap and has to
 * happen before the ETag — an encoded body is a different
 * representation and needs its own validator — while compressing is the
 * expensive half and should not run at all when the answer is a 304. */

import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { acceptedEncodings } from './precompressed';

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/* Below this, the `content-encoding` and `vary` headers cost more than
 * the body saves. The same floor the build-time pass uses. */
const MIN_COMPRESSIBLE_BYTES = 1024;
/* And it has to save at least a tenth to be worth the CPU on both ends. */
const MIN_SAVING_RATIO = 0.9;
/* 9 rather than brotli's maximum 11: a few percent smaller for roughly
 * ten times the time, which is the wrong trade per request. */
const BROTLI_QUALITY = 9;
const GZIP_LEVEL = 9;

export type ChosenEncodingInput = {
	/** The rendered HTML. */
	body: string;
	/** The request, for its `accept-encoding`. */
	request?: Request;
};

/** The encoding to use for this page, or undefined to send it as-is.
 *  Cheap: a header parse and a length check, no compression. */
export const chosenHtmlEncoding = ({ body, request }: ChosenEncodingInput) => {
	if (Buffer.byteLength(body, 'utf-8') < MIN_COMPRESSIBLE_BYTES)
		return undefined;
	const [preferred] = acceptedEncodings(
		request?.headers.get('accept-encoding') ?? null
	);

	return preferred?.encoding;
};

/** An `ETag` for the encoded representation, derived from the identity
 *  one. Keeps the weak-validator prefix and the quoting intact. */
export const taggedWithEncoding = (etag: string, encoding: string) =>
	etag.endsWith('"')
		? `${etag.slice(0, -1)}-${encoding}"`
		: `${etag}-${encoding}`;

export type CompressHtmlInput = {
	body: string;
	encoding: string;
};

export type CompressedHtml = {
	/* `Buffer`, not `Uint8Array`: zlib returns one, and a bare
	 * `Uint8Array<ArrayBufferLike>` is not a valid `BodyInit` under this
	 * TypeScript lib, because its buffer could be a SharedArrayBuffer. */
	bytes: Buffer;
	encoding: string;
};

/** The compressed body, or null when it did not save enough to be worth
 *  sending encoded. Returns data rather than a `Response` so the caller
 *  keeps control of the headers it already manages. */
export const compressHtml = async ({ body, encoding }: CompressHtmlInput) => {
	const input = Buffer.from(body, 'utf-8');
	try {
		const bytes =
			encoding === 'br'
				? await brotliAsync(input, {
						params: {
							[constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY
						}
					})
				: await gzipAsync(input, { level: GZIP_LEVEL });
		/* Compared against the input's BYTE length, not `body.length`: a
		 * page with non-ASCII content is longer in bytes than in UTF-16
		 * code units, and comparing the two overstates the saving. */
		if (bytes.byteLength > input.byteLength * MIN_SAVING_RATIO) return null;

		return { bytes, encoding };
	} catch {
		/* A page that cannot be compressed is still a page. */
		return null;
	}
};

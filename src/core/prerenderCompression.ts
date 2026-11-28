import { statSync } from 'node:fs';
import { compressHtml } from './compressHtmlResponse';
import { compressedPage, type StreamEncoding } from './compressPageStream';
import { acceptedEncodings } from './precompressed';
import { compressesPages } from '../utils/compressionRef';

/* Compressing a pre-rendered page.
 *
 * A pre-rendered page is a file, and was sent as the file. Measured on
 * a production server asking for `br, gzip`: a 5 KB pre-rendered page
 * left with no `content-encoding`, while the same page rendered per
 * request is compressed.
 *
 * It is compressed the first time it is asked for in an encoding, and
 * that copy is kept in memory and sent to everyone after. A page is
 * the same for every visitor until it is rendered again, so the work
 * is done once per page per encoding, at the buffered compressor's
 * quality and not a stream's.
 *
 * The copy is kept under the file's size and the time it was last
 * written, not written beside it on disk. A page is rewritten in
 * several places — revalidation, a page store filling the directory,
 * another worker — and a compressed file left beside one of them would
 * be served as the page after the page had changed. A copy that names
 * the version it was made from cannot outlive it. */

const MIN_COMPRESSIBLE_BYTES = 1024;
/* The most the kept copies may add up to. Past it the oldest go: a site
 * with more pre-rendered pages than this compresses the rest again when
 * they are next asked for. */
const MAX_KEPT_BYTES = 64 * 1024 * 1024;

/* The bytes as the compressor returns them: a `Buffer` over a plain
 * `ArrayBuffer`, which is what a `Response` body may be. */
type CompressedBytes = NonNullable<
	Awaited<ReturnType<typeof compressHtml>>
>['bytes'];
type Kept = { bytes: CompressedBytes | null };

const kept = new Map<string, Kept>();
const inFlight = new Map<string, Promise<Kept>>();
let keptBytes = 0;

const sizeOf = (entry: Kept | undefined) => entry?.bytes?.byteLength ?? 0;

const forgetOldest = () => {
	const [oldest] = kept.keys();
	if (oldest === undefined) return;
	keptBytes -= sizeOf(kept.get(oldest));
	kept.delete(oldest);
};

const keep = (key: string, entry: Kept) => {
	kept.set(key, entry);
	keptBytes += sizeOf(entry);
	while (keptBytes > MAX_KEPT_BYTES && kept.size > 1) forgetOldest();

	return entry;
};

const compressed = (key: string, filePath: string, encoding: string) => {
	const ready = kept.get(key);
	if (ready) return Promise.resolve(ready);
	const pending = inFlight.get(key);
	if (pending) return pending;
	// Asked for by several visitors at once, it is compressed once.
	const making = Bun.file(filePath)
		.text()
		.then((body) => compressHtml({ body, encoding }))
		.then((result) => keep(key, { bytes: result?.bytes ?? null }))
		.finally(() => inFlight.delete(key));
	inFlight.set(key, making);

	return making;
};

/** The encoding to send `request` a page in, or nothing to send it as
 *  it is. */
export const pageEncodingFor = (request: Request) => {
	if (request.method !== 'GET' || !compressesPages()) return undefined;
	const [preferred] = acceptedEncodings(
		request.headers.get('accept-encoding')
	);
	const encoding: StreamEncoding | undefined =
		preferred?.encoding === 'br' || preferred?.encoding === 'gzip'
			? preferred.encoding
			: undefined;

	return encoding;
};

const versionOf = (filePath: string) => {
	try {
		const { mtimeMs, size } = statSync(filePath);

		return { mtimeMs, size };
	} catch {
		return undefined;
	}
};

/** The pre-rendered page at `filePath`, compressed for `request`, or
 *  nothing when it is to be sent as the file: a client that accepts no
 *  encoding, a page too small to gain, or one that did not compress. */
export const compressedPrerendered = async (
	filePath: string,
	request: Request
) => {
	const encoding = pageEncodingFor(request);
	const version = encoding ? versionOf(filePath) : undefined;
	if (!encoding || !version || version.size < MIN_COMPRESSIBLE_BYTES)
		return undefined;
	const key = [filePath, version.mtimeMs, version.size, encoding].join('\0');
	const { bytes } = await compressed(key, filePath, encoding);
	if (!bytes) return undefined;

	return new Response(bytes, {
		headers: {
			'content-encoding': encoding,
			'content-type': 'text/html; charset=utf-8',
			vary: 'accept-encoding'
		}
	});
};

/** A pre-rendered shell being streamed with its dynamic parts,
 *  compressed as it streams. */
export const compressedShell = (response: Response, request: Request) => {
	const encoding = pageEncodingFor(request);
	if (!encoding || !response.ok || response.headers.has('content-encoding'))
		return response;

	return compressedPage(response, encoding);
};

/** Forgets every kept copy. For tests. */
export const resetPrerenderCompression = () => {
	kept.clear();
	inFlight.clear();
	keptBytes = 0;
};

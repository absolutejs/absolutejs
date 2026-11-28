import { compressHtml } from './compressHtmlResponse';
import { acceptedEncodings } from './precompressed';
import { compressesPages } from '../utils/compressionRef';

/* A text response the framework makes itself — a page as Markdown,
 * `llms-full.txt` — compressed for the client that asked.
 *
 * These are answered by the framework's own plugins before any route
 * runs, so no route of the app ever holds the response, and compressing
 * it changes nothing the app can see. That is what makes it safe to do
 * by default, where a page handler's response is not (see
 * docs/COMPRESSION.md). Measured before this: a page as Markdown
 * (3.7 KB) and `llms-full.txt` (13.8 KB) both left a production server
 * with no `content-encoding`.
 *
 * Buffered, and at the page compressor's quality: the whole text is in
 * hand already. */

const MIN_COMPRESSIBLE_BYTES = 1024;

/** `body` as a response with `headers`, compressed when `request`
 *  accepts an encoding and it is worth it. `compression: { pages:
 *  false }` turns this off with the pages. */
export const compressedText = async (
	body: string,
	request: Request,
	headers: Record<string, string>
) => {
	const plain = () => new Response(body, { headers });
	if (request.method !== 'GET' || !compressesPages()) return plain();
	if (Buffer.byteLength(body, 'utf-8') < MIN_COMPRESSIBLE_BYTES)
		return plain();
	const [preferred] = acceptedEncodings(
		request.headers.get('accept-encoding')
	);
	if (preferred?.encoding !== 'br' && preferred?.encoding !== 'gzip')
		return plain();
	const compressed = await compressHtml({
		body,
		encoding: preferred.encoding
	});
	if (!compressed) return plain();
	const vary = headers.vary ?? headers.Vary;

	return new Response(compressed.bytes, {
		headers: {
			...headers,
			'content-encoding': compressed.encoding,
			vary: vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding'
		}
	});
};

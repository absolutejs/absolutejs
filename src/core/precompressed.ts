import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { Elysia } from 'elysia';

/* Production served every asset uncompressed: absolutejs.ai sent its HTML,
   scripts and stylesheets at full size to every visitor, about three times
   the bytes, which on a slow network is most of the wait (2026-10-16).
   Compressing at build time costs nothing per request and never touches a
   streamed response (server-sent events, streamed pages), which is what makes
   compressing on the fly risky. The build writes `.br` and `.gz` copies beside
   each text asset; the server sends one to a browser that accepts it. */

const COMPRESSIBLE_EXTENSIONS = new Set([
	'.css',
	'.html',
	'.js',
	'.json',
	'.mjs',
	'.svg',
	'.txt',
	'.webmanifest',
	'.xml'
]);
// Smaller files gain less than the headers they cost.
const MIN_COMPRESSIBLE_BYTES = 1024;
// A copy has to save at least a tenth to be worth serving.
const MIN_SAVING_RATIO = 0.9;
// 11 compresses a few percent smaller and takes about ten times as long:
// 30 s for the example app's assets, against a few seconds at 9.
const BROTLI_QUALITY = 9;
const GZIP_LEVEL = 9;
const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const ENCODINGS = [
	{ encoding: 'br', suffix: '.br' },
	{ encoding: 'gzip', suffix: '.gz' }
] as const;

type Encoding = (typeof ENCODINGS)[number]['encoding'];

const listFiles = async (directory: string): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true }).catch(
		() => []
	);
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);

			return entry.isDirectory()
				? listFiles(path)
				: Promise.resolve(entry.isFile() ? [path] : []);
		})
	);

	return nested.flat();
};

const isCompressible = (path: string) =>
	COMPRESSIBLE_EXTENSIONS.has(extname(path).toLowerCase());

/** The encodings this browser accepts, in the order the server prefers. */
export const acceptedEncodings = (header: string | null) => {
	const accepted = new Set(
		(header ?? '')
			.split(',')
			.map((part) => part.trim().split(';'))
			.filter(
				([, quality]) =>
					!quality || !/^\s*q=0(\.0*)?\s*$/u.test(quality)
			)
			.map(([name]) => name?.trim().toLowerCase())
	);

	return ENCODINGS.filter(({ encoding }) => accepted.has(encoding));
};

/** The cache policy for a static file: forever for a content-hashed name,
 *  revalidate for anything else. */
export const assetCacheControl = (pathname: string) =>
	isFingerprintedAsset(pathname)
		? 'public, max-age=31536000, immutable'
		: 'public, max-age=0, must-revalidate';

/** Serves the precompressed copy of a static file to a browser that accepts
 *  it. Files without copies, and browsers that accept neither, fall through
 *  to the regular static handler. */
export const createPrecompressedPlugin = async (buildDir: string) => {
	const root = resolve(buildDir);
	const copies = new Map<string, Set<Encoding>>();
	for (const path of await listFiles(root)) {
		const encoding = ENCODINGS.find(({ suffix }) => path.endsWith(suffix));
		if (!encoding) continue;
		const original = path.slice(0, -encoding.suffix.length);
		const pathname = `/${relative(root, original).split(sep).join('/')}`;
		const known = copies.get(pathname) ?? new Set<Encoding>();
		known.add(encoding.encoding);
		copies.set(pathname, known);
	}

	return new Elysia({ name: 'absolutejs-precompressed' }).request(
		({ request }) => {
			if (copies.size === 0) return undefined;
			if (request.method !== 'GET' && request.method !== 'HEAD')
				return undefined;
			const { pathname } = new URL(request.url);
			const available = copies.get(decodeURIComponent(pathname));
			if (!available) return undefined;
			const chosen = acceptedEncodings(
				request.headers.get('accept-encoding')
			).find(({ encoding }) => available.has(encoding));
			if (!chosen) return undefined;
			const original = Bun.file(join(root, pathname));

			return new Response(
				Bun.file(`${join(root, pathname)}${chosen.suffix}`),
				{
					headers: {
						'cache-control': assetCacheControl(pathname),
						'content-encoding': chosen.encoding,
						'content-type': original.type,
						vary: 'Accept-Encoding'
					}
				}
			);
		}
	);
};

/* Whether a static file's name carries a content hash (`Page.a1b2c3d4.js`,
   `/chunk-xxxxxxxx.js`, the `/.absolutejs/*` hydration bundles): its URL
   changes when its content does, so it can be cached forever. A content hash
   always mixes letters and digits; a word like `generated` never does. */
export const isFingerprintedAsset = (pathname: string) => {
	if (pathname.startsWith('/.absolutejs/')) return true;
	const base = pathname.slice(pathname.lastIndexOf('/') + 1);
	const hash = base.match(/[.-]([0-9a-z]{6,12})\.[0-9a-z]+$/i)?.[1];

	return hash ? /[0-9]/.test(hash) && /[a-z]/i.test(hash) : false;
};

/** Writes `.br` and `.gz` beside every compressible file in `buildDir` that
 *  compression actually shrinks. Returns how many files got copies. */
export const writePrecompressedAssets = async (buildDir: string) => {
	const files = (await listFiles(buildDir)).filter(isCompressible);
	const written = await Promise.all(
		files.map(async (path) => {
			if ((await stat(path)).size < MIN_COMPRESSIBLE_BYTES) return false;
			const content = await readFile(path);
			const limit = content.byteLength * MIN_SAVING_RATIO;
			const [brotli, gzipped] = await Promise.all([
				brotliAsync(content, {
					params: {
						[constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
						[constants.BROTLI_PARAM_SIZE_HINT]: content.byteLength
					}
				}),
				gzipAsync(content, { level: GZIP_LEVEL })
			]);
			if (brotli.byteLength > limit) return false;
			await Promise.all([
				writeFile(`${path}.br`, brotli),
				writeFile(`${path}.gz`, gzipped)
			]);

			return true;
		})
	);

	return written.filter(Boolean).length;
};

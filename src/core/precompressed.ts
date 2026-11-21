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

/** The cache policy for a static file: forever for a path the build
 *  hashed, revalidate for anything else. */
export const assetCacheControl = (
	pathname: string,
	hashed?: FingerprintedAssets
) =>
	isFingerprintedAsset(pathname, hashed)
		? 'public, max-age=31536000, immutable'
		: 'public, max-age=0, must-revalidate';

/** Applies `assetCacheControl` to static-file responses. @elysia/static
 *  answers a plain GET with the file itself and its blanket policy on
 *  `set.headers`, and a precompressed or HEAD answer with a `Response`;
 *  both get the policy replaced (not appended). Only paths with an
 *  extension are touched, and a non-Response value only when a policy was
 *  already set, so pages and APIs keep their own headers. */
export const createAssetCachePlugin = (hashed?: FingerprintedAssets) =>
	new Elysia({ name: 'absolutejs-asset-cache' }).onAfterHandle(
		'global',
		({ request, responseValue, set }) => {
			if (request.method !== 'GET' && request.method !== 'HEAD') return;
			const { pathname } = new URL(request.url);
			if (pathname.endsWith('/') || !/\.[0-9a-z]+$/i.test(pathname))
				return;
			const policy = assetCacheControl(pathname, hashed);
			if (responseValue instanceof Response) {
				responseValue.headers.set('cache-control', policy);

				return;
			}
			if (set.headers['cache-control'] !== undefined)
				set.headers['cache-control'] = policy;
		}
	);

/** Serves the precompressed copy of a static file to a browser that accepts
 *  it. Files without copies, and browsers that accept neither, fall through
 *  to the regular static handler. */
export const createPrecompressedPlugin = async (
	buildDir: string,
	ignorePatterns: readonly (string | RegExp)[] = [],
	/* The build's hashed paths, for the same reason the static handler gets
	 *  them. Omitting them is not a smaller version of the policy, it is the
	 *  wrong one: this plugin answers from `onRequest`, which short-circuits
	 *  the handler lifecycle, so `createAssetCachePlugin`'s `onAfterHandle`
	 *  never runs over this response and cannot correct it. Without the set,
	 *  only the name heuristics apply, and Bun's `[hash]` is base36 — so
	 *  `vue-example.wvc7v0t6.css` served `max-age=0, must-revalidate` while
	 *  the very same file served `immutable` to a client that accepted no
	 *  encoding. Every real browser accepts gzip, so in practice every
	 *  hashed asset revalidated on every page load. */
	hashed?: FingerprintedAssets
) => {
	const root = resolve(buildDir);
	const copies = new Map<string, Set<Encoding>>();
	// Same matching as `@elysia/static`'s `ignorePatterns`, so a file kept
	// off the static routes isn't served through its compressed copy.
	const isIgnored = (pathname: string) =>
		ignorePatterns.some((pattern) =>
			typeof pattern === 'string'
				? pathname.includes(pattern)
				: pattern.test(pathname)
		);
	for (const path of await listFiles(root)) {
		const encoding = ENCODINGS.find(({ suffix }) => path.endsWith(suffix));
		if (!encoding) continue;
		const original = path.slice(0, -encoding.suffix.length);
		const pathname = `/${relative(root, original).split(sep).join('/')}`;
		if (isIgnored(pathname)) continue;
		const known = copies.get(pathname) ?? new Set<Encoding>();
		known.add(encoding.encoding);
		copies.set(pathname, known);
	}

	return new Elysia({ name: 'absolutejs-precompressed' }).onRequest(
		({ request }) => {
			if (copies.size === 0) return undefined;
			if (request.method !== 'GET' && request.method !== 'HEAD')
				return undefined;
			const { pathname } = new URL(request.url);
			let decodedPathname: string;
			try {
				decodedPathname = decodeURIComponent(pathname);
			} catch {
				return new Response('Malformed URL path', { status: 400 });
			}
			const available = copies.get(decodedPathname);
			if (!available) return undefined;
			const chosen = acceptedEncodings(
				request.headers.get('accept-encoding')
			).find(({ encoding }) => available.has(encoding));
			if (!chosen) return undefined;
			const original = Bun.file(join(root, decodedPathname));

			return new Response(
				Bun.file(`${join(root, decodedPathname)}${chosen.suffix}`),
				{
					headers: {
						'cache-control': assetCacheControl(pathname, hashed),
						'content-encoding': chosen.encoding,
						'content-type': original.type,
						vary: 'Accept-Encoding'
					}
				}
			);
		}
	);
};

/* A code-splitting chunk: `chunk-k3x9a0bq.js`, emitted by the client
 * passes and referenced only from a hashed entry. The build does not
 * record these individually, and nothing but the bundler writes that
 * name, so this is the one shape still recognised by its name. */
const CHUNK_NAME = /^chunk-[0-9a-z]{8,}\.js$/i;

/* This framework's own content hash: exactly eight hex characters before
 * the extension (`fontAssets.ts`'s `fingerprint()`). Every hand-written
 * name that the old rule caught carries a letter outside hex —
 * `sprite24`, `1080p60`, `v2final`, and the `x` in `512x512` — so this
 * admits the hashes and none of them. Bun's own `[hash]` is base36 and
 * wider than hex, which is why the manifest is consulted as well. */
const HEX_HASH_NAME = /\.[0-9a-f]{8}\.[0-9a-z]+$/i;

/* Which static files may be cached forever.
 *
 * This used to be a guess from the file name: a 6-12 character segment
 * mixing letters and digits was treated as a content hash. It pinned the
 * most conventional hand-named assets there are for a year, with
 * `immutable`, so the browser would not even revalidate:
 *
 *   /icons/icon-192x192.png     192x192
 *   /icons/icon-512x512.png     512x512
 *   /assets/icons-sprite24.svg  sprite24
 *   /video/clip-1080p60.mp4     1080p60
 *
 * Replace a PWA icon on a rebrand and returning visitors keep the old one
 * for up to a year, with no way to force a refresh. That is the opposite
 * of what a cache policy should fail towards.
 *
 * So the build is asked instead of guessed at: `prepare()` passes the
 * hashed paths from `manifest.json`, whose URL does change with its
 * content. Anything else revalidates — one conditional request, answered
 * 304 — which costs a round trip and cannot serve a stale year. */
export type FingerprintedAssets = { has: (pathname: string) => boolean };

const chunkName = (pathname: string) =>
	pathname.slice(pathname.lastIndexOf('/') + 1);

/** Whether a static file's URL changes when its content does. */
export const isFingerprintedAsset = (
	pathname: string,
	hashed?: FingerprintedAssets
) =>
	pathname.startsWith('/.absolutejs/') ||
	CHUNK_NAME.test(chunkName(pathname)) ||
	HEX_HASH_NAME.test(chunkName(pathname)) ||
	(hashed?.has(pathname) ?? false);

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

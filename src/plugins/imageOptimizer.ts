import { existsSync, realpathSync, statSync } from 'node:fs';
import { Elysia } from 'elysia';
import type { ImageConfig, ImageFormat } from '../../types/image';
import {
	type CacheMeta,
	DEFAULT_DEVICE_SIZES,
	DEFAULT_IMAGE_SIZES,
	DEFAULT_QUALITY,
	OPTIMIZATION_ENDPOINT,
	formatToMime,
	sniffImageMime,
	getCacheDir,
	getCacheKey,
	isCacheStale,
	matchRemotePattern,
	negotiateFormat,
	optimizeImage,
	pruneCache,
	readCacheSize,
	readFromCache,
	writeToCache
} from '../utils/imageProcessing';
import { validateSafePath } from '../utils/validateSafePath';

/** Default cache TTL in seconds */
const DEFAULT_CACHE_TTL_SECONDS = 60;

/** Milliseconds per second */
const MS_PER_SECOND = 1000;

/** Maximum image quality value */
const MAX_QUALITY = 100;

/** Largest source image, local or remote, the optimizer will read */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

/** How long a remote source may take to respond and download */
const REMOTE_FETCH_TIMEOUT_MS = 10_000;

/** Redirects followed for a remote source; each hop is re-checked */
const MAX_REMOTE_REDIRECTS = 3;

/** Default bound on the disk cache, in bytes */
const DEFAULT_MAXIMUM_CACHE_SIZE = 512 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const PATH_SEPARATOR_PATTERN = /[\\/]/;

/** Set of AVIF cache keys currently being generated to avoid duplicate work */
const avifInProgress = new Set<string>();

/** Resolve a path inside a base directory, following symlinks, or null
 *  when the file is missing or its real location is outside the base */
const safeResolve = (path: string, baseDir: string) => {
	try {
		const resolved = validateSafePath(path, baseDir);
		if (!existsSync(resolved)) return null;

		return validateSafePath(realpathSync(resolved), realpathSync(baseDir));
	} catch {
		return null;
	}
};

/** Resolve a local image against the build directory, the only place a
 *  site's public files live. Dot-segments are refused outright: nothing
 *  under `.env`, `.cache` or `..` is an image a page links to. */
const resolveLocalImage = (url: string, buildDir: string) => {
	const cleanPath = url.startsWith('/') ? url.slice(1) : url;
	const hasDotSegment = cleanPath
		.split(PATH_SEPARATOR_PATTERN)
		.some((segment) => segment.startsWith('.'));
	if (hasDotSegment) return null;

	return safeResolve(cleanPath, buildDir);
};

const notFound = (url: string) =>
	new Response(`Image not found: ${url}`, { status: 404 });

type BodyReader = ReadableStreamDefaultReader<Uint8Array>;

/** Drain a body chunk by chunk, stopping once it passes the size limit */
const readChunks = async (
	reader: BodyReader,
	chunks: Uint8Array[] = [],
	total = 0
): Promise<Uint8Array[] | null> => {
	const { done, value } = await reader.read();
	if (done) return chunks;

	const size = total + value.byteLength;
	if (size > MAX_SOURCE_BYTES) {
		await reader.cancel();

		return null;
	}
	chunks.push(value);

	return readChunks(reader, chunks, size);
};

/** Read a response body, giving up once it passes the size limit */
const readCappedBody = async (response: Response) => {
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > MAX_SOURCE_BYTES || !response.body) return null;

	const chunks = await readChunks(response.body.getReader());

	return chunks ? Buffer.concat(chunks) : null;
};

/** Fetch a remote source without following redirects blindly: every hop
 *  has to match `remotePatterns`, or an allowed host could bounce the
 *  server to an address the allow-list was written to exclude. */
const fetchRemoteImage = async (
	url: string,
	remotePatterns: ImageConfig['remotePatterns'] & object,
	signal: AbortSignal,
	redirectsLeft = MAX_REMOTE_REDIRECTS
): Promise<
	{ error: Response } | { buffer: Buffer; upstreamEtag: string | undefined }
> => {
	const response = await fetch(url, { redirect: 'manual', signal });

	if (REDIRECT_STATUSES.has(response.status)) {
		const location = response.headers.get('location');
		const next = location ? new URL(location, url).href : null;
		if (
			!next ||
			redirectsLeft === 0 ||
			!matchRemotePattern(next, remotePatterns)
		) {
			return {
				error: new Response('Remote image redirect not allowed', {
					status: 502
				})
			};
		}

		return fetchRemoteImage(
			next,
			remotePatterns,
			signal,
			redirectsLeft - 1
		);
	}

	if (!response.ok) {
		return {
			error: new Response(
				`Failed to fetch remote image: ${response.status}`,
				{ status: 502 }
			)
		};
	}

	const buffer = await readCappedBody(response);
	if (!buffer) {
		return {
			error: new Response('Remote image is too large', { status: 502 })
		};
	}

	return {
		buffer,
		upstreamEtag: response.headers.get('ETag') ?? undefined
	};
};

/** Parse and validate query parameters, returning an error Response or valid params */
const parseQueryParams = (
	query: Record<string, string | undefined>,
	allowedSizes: Set<number>,
	defaultQuality: number
) => {
	const url = typeof query['url'] === 'string' ? query['url'] : undefined;
	const wParam = typeof query['w'] === 'string' ? query['w'] : undefined;
	const qParam = typeof query['q'] === 'string' ? query['q'] : undefined;

	if (!url || !wParam) {
		return {
			error: new Response('Missing required params: url, w', {
				status: 400
			})
		};
	}

	const width = parseInt(wParam, 10);
	if (isNaN(width) || !allowedSizes.has(width)) {
		return {
			error: new Response(
				`Invalid width: ${wParam}. Must be one of: ${[...allowedSizes].sort((left, right) => left - right).join(', ')}`,
				{ status: 400 }
			)
		};
	}

	const quality = qParam ? parseInt(qParam, 10) : defaultQuality;
	if (isNaN(quality) || quality < 1 || quality > MAX_QUALITY) {
		return {
			error: new Response('Invalid quality: must be 1-100', {
				status: 400
			})
		};
	}

	return { params: { quality, url, width } };
};

/** Validate security for the given image URL */
const validateImageSecurity = (
	url: string,
	remotePatterns: ImageConfig['remotePatterns'] & object,
	buildDir: string
) => {
	const isRemote = url.startsWith('http://') || url.startsWith('https://');

	if (isRemote) {
		if (
			remotePatterns.length === 0 ||
			!matchRemotePattern(url, remotePatterns)
		) {
			return {
				error: new Response(
					'Remote image not allowed. Configure remotePatterns in images config.',
					{ status: 400 }
				),
				isRemote
			};
		}

		return { isRemote, resolvedPath: null };
	}

	const resolvedPath = resolveLocalImage(url, buildDir);
	if (!resolvedPath) {
		return { error: notFound(url), isRemote };
	}

	return { isRemote, resolvedPath };
};

/** Fetch the source image buffer from remote URL or local file */
const fetchSourceImage = async (
	url: string,
	isRemote: boolean,
	resolvedPath: string | null,
	remotePatterns: ImageConfig['remotePatterns'] & object
) => {
	if (isRemote) {
		return fetchRemoteImage(
			url,
			remotePatterns,
			AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS)
		);
	}

	if (!resolvedPath) return { error: notFound(url) };

	const file = Bun.file(resolvedPath);
	if (!(await file.exists()) || !statSync(resolvedPath).isFile()) {
		return { error: notFound(url) };
	}
	if (file.size > MAX_SOURCE_BYTES) return { error: notFound(url) };

	return {
		buffer: Buffer.from(await file.arrayBuffer()),
		upstreamEtag: undefined
	};
};

/** Schedule AVIF pre-generation in the background */
const scheduleAvifPregen = (
	url: string,
	width: number,
	quality: number,
	sourceBuffer: Buffer,
	configuredFormats: ImageFormat[],
	format: ImageFormat,
	cacheDir: string,
	minimumCacheTTL: number,
	upstreamEtag: string | undefined,
	store: (cacheKey: string, buffer: Buffer, meta: CacheMeta) => void
) => {
	if (!configuredFormats.includes('avif') || format === 'avif') {
		return;
	}

	const avifKey = `${url}|${width}|${quality}`;
	if (avifInProgress.has(avifKey)) return;

	const avifCacheKey = getCacheKey(url, width, quality, 'avif');
	const avifCached = readFromCache(cacheDir, avifCacheKey);
	if (avifCached && !isCacheStale(avifCached.meta)) return;

	avifInProgress.add(avifKey);
	queueMicrotask(async () => {
		try {
			const avifBuffer = await optimizeImage(
				sourceBuffer,
				width,
				quality,
				'avif'
			);
			const avifMeta: CacheMeta = {
				contentType: 'image/avif',
				etag: `"${avifCacheKey}"`,
				expireAt: Date.now() + minimumCacheTTL,
				upstreamEtag
			};
			store(avifCacheKey, avifBuffer, avifMeta);
		} catch {
			// AVIF generation failure is non-fatal
		} finally {
			avifInProgress.delete(avifKey);
		}
	});
};

export const imageOptimizer = (
	config: ImageConfig | undefined,
	buildDir: string
) => {
	const plugin = new Elysia({ name: 'image-optimizer' });

	// No-op if disabled or no config
	if (!config && config !== undefined) return plugin;
	if (config?.unoptimized) return plugin;

	const endpointPath = config?.path ?? OPTIMIZATION_ENDPOINT;
	const allowedSizes = new Set([
		...(config?.deviceSizes ?? DEFAULT_DEVICE_SIZES),
		...(config?.imageSizes ?? DEFAULT_IMAGE_SIZES)
	]);
	const defaultQuality = config?.quality ?? DEFAULT_QUALITY;
	const minimumCacheTTL =
		(config?.minimumCacheTTL ?? DEFAULT_CACHE_TTL_SECONDS) * MS_PER_SECOND;
	const cacheControlHeader = `public, max-age=${Math.ceil(minimumCacheTTL / MS_PER_SECOND)}, must-revalidate`;
	const configuredFormats: ImageFormat[] = config?.formats ?? ['webp'];
	const remotePatterns = config?.remotePatterns ?? [];
	const cacheDir = getCacheDir(buildDir, config?.cacheDirectory);
	const maximumCacheSize =
		config?.maximumCacheSize ?? DEFAULT_MAXIMUM_CACHE_SIZE;

	// Bytes on disk, counted once and then kept current by each write, so
	// the directory is only walked again when the bound is crossed.
	let cacheSize: number | undefined;
	const store = (cacheKey: string, buffer: Buffer, meta: CacheMeta) => {
		cacheSize ??= readCacheSize(cacheDir);
		writeToCache(cacheDir, cacheKey, buffer, meta);
		cacheSize += buffer.byteLength;
		if (cacheSize <= maximumCacheSize) return;
		cacheSize = pruneCache(cacheDir, maximumCacheSize);
	};

	return plugin.get(endpointPath, async ({ query, request }) => {
		// ── Parse & Validate ────────────────────────────────
		const parsed = parseQueryParams(query, allowedSizes, defaultQuality);
		if ('error' in parsed) return parsed.error;
		const { quality, url, width } = parsed.params;

		// ── Security ────────────────────────────────────────
		const security = validateImageSecurity(url, remotePatterns, buildDir);
		if ('error' in security) return security.error;
		const { isRemote, resolvedPath } = security;

		// ── Content Negotiation ─────────────────────────────
		const acceptHeader = request.headers.get('Accept') ?? '';
		const format = negotiateFormat(acceptHeader, configuredFormats);
		let mime = formatToMime(format);

		// ── Cache Lookup ────────────────────────────────────
		const cacheKey = getCacheKey(url, width, quality, format);
		const cachedEntry = readFromCache(cacheDir, cacheKey);
		// An entry that is not an image was written before sources were
		// checked; never serve it.
		const cached =
			cachedEntry && sniffImageMime(cachedEntry.buffer)
				? cachedEntry
				: null;

		if (cached && !isCacheStale(cached.meta)) {
			const ifNoneMatch = request.headers.get('If-None-Match');
			if (ifNoneMatch && ifNoneMatch === cached.meta.etag) {
				return new Response(null, {
					headers: {
						'Cache-Control': cacheControlHeader,
						ETag: cached.meta.etag,
						Vary: 'Accept'
					},
					status: 304
				});
			}

			return new Response(new Uint8Array(cached.buffer), {
				headers: {
					'Cache-Control': cacheControlHeader,
					'Content-Type': cached.meta.contentType,
					ETag: cached.meta.etag,
					Vary: 'Accept'
				}
			});
		}

		// ── Fetch Source ────────────────────────────────────
		let sourceBuffer: Buffer;
		let upstreamEtag: string | undefined;

		try {
			const source = await fetchSourceImage(
				url,
				isRemote,
				resolvedPath ?? null,
				remotePatterns
			);
			if ('error' in source) return source.error;
			sourceBuffer = source.buffer;
			({ upstreamEtag } = source);
		} catch (err) {
			return new Response(
				`Failed to load image: ${err instanceof Error ? err.message : 'unknown error'}`,
				{ status: 500 }
			);
		}

		// ── Source Check ────────────────────────────────────
		// Only bytes that are an image go any further. Without this the
		// fallback below would hand back whatever file the URL named.
		if (!sniffImageMime(sourceBuffer)) {
			return isRemote
				? new Response('Remote source is not an image', { status: 502 })
				: notFound(url);
		}

		// ── Optimize ────────────────────────────────────────
		let optimizedBuffer: Buffer;
		try {
			optimizedBuffer = await optimizeImage(
				sourceBuffer,
				width,
				quality,
				format
			);
		} catch {
			// Graceful degradation: serve the original — under its own type,
			// not the negotiated one, or the browser gets (say) webp bytes
			// labelled image/jpeg and shows a broken image.
			optimizedBuffer = sourceBuffer;
			mime = sniffImageMime(sourceBuffer) ?? mime;
		}

		// ── Cache Write ─────────────────────────────────────
		const etag = `"${cacheKey}"`;
		const meta: CacheMeta = {
			contentType: mime,
			etag,
			expireAt: Date.now() + minimumCacheTTL,
			upstreamEtag
		};

		try {
			store(cacheKey, optimizedBuffer, meta);
		} catch {
			// Cache write failure is non-fatal
		}

		// ── AVIF Async Pre-generation ───────────────────────
		scheduleAvifPregen(
			url,
			width,
			quality,
			sourceBuffer,
			configuredFormats,
			format,
			cacheDir,
			minimumCacheTTL,
			upstreamEtag,
			store
		);

		// ── Response ────────────────────────────────────────
		return new Response(new Uint8Array(optimizedBuffer), {
			headers: {
				'Cache-Control': cacheControlHeader,
				'Content-Type': mime,
				ETag: etag,
				Vary: 'Accept'
			}
		});
	});
};

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Elysia } from 'elysia';
import type { ImageConfig, ImageFormat } from '../../types/image';
import {
	type CacheMeta,
	DEFAULT_DEVICE_SIZES,
	DEFAULT_IMAGE_SIZES,
	DEFAULT_QUALITY,
	OPTIMIZATION_ENDPOINT,
	formatToMime,
	getCacheDir,
	getCacheKey,
	isCacheStale,
	matchRemotePattern,
	negotiateFormat,
	optimizeImage,
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

/** Set of AVIF cache keys currently being generated to avoid duplicate work */
const avifInProgress = new Set<string>();

/** Try to resolve a path safely against a base directory, returning null if the file doesn't exist */
const safeResolve = (path: string, baseDir: string) => {
	try {
		const resolved = validateSafePath(path, baseDir);

		if (existsSync(resolved)) return resolved;

		return null;
	} catch {
		return null;
	}
};

/** Resolve a local image path against build dir and project root */
const resolveLocalImage = (url: string, buildDir: string) => {
	const cleanPath = url.startsWith('/') ? url.slice(1) : url;

	return (
		safeResolve(cleanPath, buildDir) ??
		safeResolve(cleanPath, resolve(process.cwd()))
	);
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
		return {
			error: new Response(`Image not found: ${url}`, { status: 404 }),
			isRemote
		};
	}

	return { isRemote, resolvedPath };
};

/** Fetch the source image buffer from remote URL or local file */
const fetchSourceImage = async (
	url: string,
	isRemote: boolean,
	resolvedPath: string | null
) => {
	if (isRemote) {
		const response = await fetch(url);
		if (!response.ok) {
			return {
				error: new Response(
					`Failed to fetch remote image: ${response.status}`,
					{ status: 502 }
				)
			};
		}

		return {
			buffer: Buffer.from(await response.arrayBuffer()),
			upstreamEtag: response.headers.get('ETag') ?? undefined
		};
	}

	if (!resolvedPath) {
		return {
			error: new Response(`Image not found: ${url}`, { status: 404 })
		};
	}

	const file = Bun.file(resolvedPath);
	if (!(await file.exists())) {
		return {
			error: new Response(`Image not found: ${url}`, { status: 404 })
		};
	}

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
	upstreamEtag: string | undefined
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
			writeToCache(cacheDir, avifCacheKey, avifBuffer, avifMeta);
		} catch {
			// AVIF generation failure is non-fatal
		} finally {
			avifInProgress.delete(avifKey);
		}
	});
};

export const imageOptimizer =
	(config: ImageConfig | undefined, buildDir: string) =>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Elysia generics vary per plugin chain
	(app: any) => {
		// No-op if disabled or no config
		if (!config && config !== undefined) return app;
		if (config?.unoptimized) return app;

		const endpointPath = config?.path ?? OPTIMIZATION_ENDPOINT;
		const allowedSizes = new Set([
			...(config?.deviceSizes ?? DEFAULT_DEVICE_SIZES),
			...(config?.imageSizes ?? DEFAULT_IMAGE_SIZES)
		]);
		const defaultQuality = config?.quality ?? DEFAULT_QUALITY;
		const minimumCacheTTL =
			(config?.minimumCacheTTL ?? DEFAULT_CACHE_TTL_SECONDS) *
			MS_PER_SECOND;
		const configuredFormats: ImageFormat[] = config?.formats ?? ['webp'];
		const remotePatterns = config?.remotePatterns ?? [];
		const cacheDir = getCacheDir(buildDir);

		const plugin = new Elysia({ name: 'image-optimizer' }).get(
			endpointPath,
			async ({ query, request }) => {
				// ── Parse & Validate ────────────────────────────────
				const parsed = parseQueryParams(
					query,
					allowedSizes,
					defaultQuality
				);
				if ('error' in parsed) return parsed.error;
				const { quality, url, width } = parsed.params;

				// ── Security ────────────────────────────────────────
				const security = validateImageSecurity(
					url,
					remotePatterns,
					buildDir
				);
				if ('error' in security) return security.error;
				const { isRemote, resolvedPath } = security;

				// ── Content Negotiation ─────────────────────────────
				const acceptHeader = request.headers.get('Accept') ?? '';
				const format = negotiateFormat(acceptHeader, configuredFormats);
				const mime = formatToMime(format);

				// ── Cache Lookup ────────────────────────────────────
				const cacheKey = getCacheKey(url, width, quality, format);
				const cached = readFromCache(cacheDir, cacheKey);

				if (cached && !isCacheStale(cached.meta)) {
					const ifNoneMatch = request.headers.get('If-None-Match');
					if (ifNoneMatch && ifNoneMatch === cached.meta.etag) {
						return new Response(null, {
							headers: {
								'Cache-Control': `public, max-age=${Math.ceil(minimumCacheTTL / MS_PER_SECOND)}, must-revalidate`,
								ETag: cached.meta.etag,
								Vary: 'Accept'
							},
							status: 304
						});
					}

					return new Response(new Uint8Array(cached.buffer), {
						headers: {
							'Cache-Control': `public, max-age=${Math.ceil(minimumCacheTTL / MS_PER_SECOND)}, must-revalidate`,
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
						resolvedPath ?? null
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
					// Graceful degradation: serve original
					optimizedBuffer = sourceBuffer;
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
					writeToCache(cacheDir, cacheKey, optimizedBuffer, meta);
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
					upstreamEtag
				);

				// ── Response ────────────────────────────────────────
				return new Response(new Uint8Array(optimizedBuffer), {
					headers: {
						'Cache-Control': `public, max-age=${Math.ceil(minimumCacheTTL / MS_PER_SECOND)}, must-revalidate`,
						'Content-Type': mime,
						ETag: etag,
						Vary: 'Accept'
					}
				});
			}
		);

		return app.use(plugin);
	};

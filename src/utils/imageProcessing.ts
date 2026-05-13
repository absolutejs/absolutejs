import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
	ImageConfig,
	ImageFormat,
	RemotePattern
} from '../../types/image';
import {
	IMAGE_DEFAULT_DEVICE_SIZES,
	IMAGE_DEFAULT_IMAGE_SIZES,
	IMAGE_DEFAULT_QUALITY,
	IMAGE_GLOB_SUFFIX_LENGTH
} from '../constants';

// ── Constants ──────────────────────────────────────────────────────

export const DEFAULT_DEVICE_SIZES = IMAGE_DEFAULT_DEVICE_SIZES;
export const DEFAULT_IMAGE_SIZES = IMAGE_DEFAULT_IMAGE_SIZES;
export const DEFAULT_QUALITY = IMAGE_DEFAULT_QUALITY;

export const OPTIMIZATION_ENDPOINT = '/_absolute/image';

// ── Blur Placeholder ───────────────────────────────────────────────

const BLUR_SIZE = 8;
const BLUR_QUALITY = 70;
const BLUR_DEVIATION = 20;

// ── Sharp Loading (AVIF fallback only — see docs/SHARP_REMOVAL.md) ─

let sharpModule: unknown = undefined;
let sharpLoaded = false;
let sharpWarned = false;

// ── Shared Internals ───────────────────────────────────────────────

/** Snap a target width UP to the nearest configured size */
const snapToSize = (target: number, sizes: number[]) => {
	for (const size of sizes) {
		if (size >= target) return size;
	}

	return sizes[sizes.length - 1] ?? target;
};

/** Match hostname with wildcard support: "*.example.com" matches "cdn.example.com" */
const matchHostname = (actual: string, pattern: string) => {
	if (pattern === actual) return true;

	if (pattern.startsWith('*.')) {
		const suffix = pattern.slice(1); // ".example.com"

		return actual.endsWith(suffix) && actual.length > suffix.length;
	}

	return false;
};

/** Match pathname with glob prefix: "/images/**" matches "/images/photo.jpg" */
const matchPathname = (actual: string, pattern: string) => {
	if (pattern.endsWith('/**')) {
		const prefix = pattern.slice(0, -IMAGE_GLOB_SUFFIX_LENGTH);

		return actual.startsWith(prefix);
	}

	return actual === pattern;
};

const MIME_MAP: Record<ImageFormat, string> = {
	avif: 'image/avif',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
};

type SharpPipeline = {
	avif: (options: { effort: number; quality: number }) => SharpPipeline;
	jpeg: (options: { mozjpeg?: boolean; quality: number }) => SharpPipeline;
	png: (options: { quality: number }) => SharpPipeline;
	resize: (
		width: number,
		height?: number,
		options?: { fit?: string; withoutEnlargement?: boolean }
	) => SharpPipeline;
	rotate: () => SharpPipeline;
	toBuffer: () => Promise<Buffer>;
	webp: (options: { quality: number }) => SharpPipeline;
};

type SharpFactory = (input: Buffer) => SharpPipeline;

const isSharpFactory = (value: unknown): value is SharpFactory =>
	typeof value === 'function';

const toBuffer = (input: Buffer | ArrayBuffer) => {
	if (Buffer.isBuffer(input)) return input;

	return Buffer.from(input);
};

const isUnsupportedFormatError = (err: unknown) =>
	typeof err === 'object' &&
	err !== null &&
	'code' in err &&
	(err as { code?: string }).code === 'ERR_IMAGE_FORMAT_UNSUPPORTED';

// ── Exports (alphabetically sorted) ────────────────────────────────

export const buildOptimizedUrl = (
	src: string,
	width: number,
	quality: number,
	basePath = OPTIMIZATION_ENDPOINT
) => `${basePath}?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;

export type CacheMeta = {
	contentType: string;
	etag: string;
	expireAt: number;
	upstreamEtag?: string;
};

export const formatToMime = (format: ImageFormat) => MIME_MAP[format];

export const generateBlurDataURL = async (buffer: Buffer | ArrayBuffer) => {
	const tiny = await new Bun.Image(toBuffer(buffer))
		.resize(BLUR_SIZE, BLUR_SIZE, { fit: 'inside' })
		.webp({ quality: BLUR_QUALITY })
		.toBuffer();

	return `data:image/webp;base64,${tiny.toString('base64')}`;
};

export const generateBlurSvg = (base64Thumbnail: string) => {
	// Match Next.js: wrap tiny thumbnail in SVG with Gaussian blur
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><filter id="b" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${BLUR_DEVIATION}"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 100 -1"/></filter><image filter="url(#b)" x="0" y="0" width="100%" height="100%" href="${base64Thumbnail}"/></svg>`;

	const encoded = encodeURIComponent(svg);

	return `url("data:image/svg+xml,${encoded}")`;
};

export const generateSrcSet = (
	src: string,
	width: number | undefined,
	sizes: string | undefined,
	config?: ImageConfig,
	loader?: (params: { quality: number; src: string; width: number }) => string
) => {
	const quality = config?.quality ?? DEFAULT_QUALITY;

	const basePath = config?.path ?? OPTIMIZATION_ENDPOINT;

	const buildUrl =
		loader ??
		((params: { quality: number; src: string; width: number }) =>
			buildOptimizedUrl(
				params.src,
				params.width,
				params.quality,
				basePath
			));

	if (sizes) {
		// With sizes: use all breakpoints with w descriptors
		const allSizes = getAllSizes(config);

		return allSizes
			.map(
				(sizeWidth) =>
					`${buildUrl({ quality, src, width: sizeWidth })} ${sizeWidth}w`
			)
			.join(', ');
	}

	if (width) {
		// Without sizes: generate 1x and 2x density descriptors
		const allSizes = getAllSizes(config);

		const w1x = snapToSize(width, allSizes);

		const w2x = snapToSize(width * 2, allSizes);

		return `${buildUrl({ quality, src, width: w1x })} 1x, ${buildUrl({ quality, src, width: w2x })} 2x`;
	}

	// No width or sizes — use device sizes with w descriptors
	const deviceSizes = config?.deviceSizes ?? DEFAULT_DEVICE_SIZES;

	return deviceSizes
		.map(
			(sizeWidth) =>
				`${buildUrl({ quality, src, width: sizeWidth })} ${sizeWidth}w`
		)
		.join(', ');
};

export const getAllSizes = (config?: ImageConfig) => {
	const device = config?.deviceSizes ?? DEFAULT_DEVICE_SIZES;

	const image = config?.imageSizes ?? DEFAULT_IMAGE_SIZES;

	return [...device, ...image].sort((left, right) => left - right);
};

export const getCacheDir = (buildDir: string) => {
	const dir = join(buildDir, '.cache', 'images');

	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	return dir;
};

export const getCacheKey = (
	url: string,
	width: number,
	quality: number,
	format: string
) => {
	const hasher = new Bun.CryptoHasher('sha256');

	hasher.update(`${url}|${width}|${quality}|${format}`);

	return hasher.digest('hex');
};

export const isCacheStale = (meta: CacheMeta) => Date.now() > meta.expireAt;

export const matchRemotePattern = (
	urlString: string,
	patterns: RemotePattern[]
) => {
	let parsed: URL;

	try {
		parsed = new URL(urlString);
	} catch {
		return false;
	}

	return patterns.some((pattern) => {
		if (pattern.protocol && parsed.protocol !== `${pattern.protocol}:`)
			return false;

		if (!matchHostname(parsed.hostname, pattern.hostname)) return false;

		if (pattern.port && parsed.port !== pattern.port) return false;

		if (
			pattern.pathname &&
			!matchPathname(parsed.pathname, pattern.pathname)
		)
			return false;

		return true;
	});
};

export const negotiateFormat = (
	acceptHeader: string,
	configuredFormats: ImageFormat[]
) => {
	// Check configured formats in preference order against Accept header
	for (const format of configuredFormats) {
		const mime = MIME_MAP[format];

		if (mime && acceptHeader.includes(mime)) return format;
	}

	// Fallback: if webp is configured and accepted, use it
	if (
		configuredFormats.includes('webp') &&
		acceptHeader.includes('image/webp')
	) {
		return 'webp';
	}

	// Final fallback to jpeg
	return 'jpeg';
};

const AVIF_QUALITY_OFFSET = 20;
const AVIF_EFFORT = 3;
const PNG_COMPRESSION_LEVEL = 9;

const optimizeWithBunImage = async (
	buffer: Buffer,
	width: number,
	quality: number,
	format: ImageFormat
) => {
	// autoOrient defaults to true — EXIF orientation is applied automatically.
	// Pipeline order is fixed: autoOrient → rotate → flip → resize → modulate.
	const pipeline = new Bun.Image(buffer).resize(width, undefined, {
		withoutEnlargement: true
	});

	switch (format) {
		case 'avif':
			return pipeline
				.avif({
					quality: Math.max(1, quality - AVIF_QUALITY_OFFSET)
				})
				.toBuffer();
		case 'jpeg':
			return pipeline.jpeg({ quality }).toBuffer();
		case 'png':
			return pipeline
				.png({ compressionLevel: PNG_COMPRESSION_LEVEL })
				.toBuffer();
		case 'webp':
			return pipeline.webp({ quality }).toBuffer();
	}
};

const optimizeWithSharp = async (
	sharpRef: SharpFactory,
	buffer: Buffer,
	width: number,
	quality: number,
	format: ImageFormat
) => {
	const pipeline = sharpRef(buffer)
		.rotate()
		.resize(width, undefined, { withoutEnlargement: true });

	switch (format) {
		case 'avif':
			return pipeline
				.avif({
					effort: AVIF_EFFORT,
					quality: Math.max(1, quality - AVIF_QUALITY_OFFSET)
				})
				.toBuffer();
		case 'jpeg':
			return pipeline.jpeg({ mozjpeg: true, quality }).toBuffer();
		case 'png':
			return pipeline.png({ quality }).toBuffer();
		case 'webp':
			return pipeline.webp({ quality }).toBuffer();
	}
};

export const optimizeImage = async (
	buffer: Buffer | ArrayBuffer,
	width: number,
	quality: number,
	format: ImageFormat
) => {
	const input = toBuffer(buffer);

	try {
		return await optimizeWithBunImage(input, width, quality, format);
	} catch (err) {
		// Bun.Image AVIF encode requires macOS Apple Silicon M3+ or Windows with
		// AV1 Video Extension — falls back to sharp on other platforms.
		if (format === 'avif' && isUnsupportedFormatError(err)) {
			const sharp = await tryLoadSharp();

			if (sharp && isSharpFactory(sharp)) {
				return optimizeWithSharp(sharp, input, width, quality, format);
			}
		}

		throw err;
	}
};

export const readFromCache = (cacheDir: string, cacheKey: string) => {
	const metaPath = join(cacheDir, `${cacheKey}.meta`);

	const dataPath = join(cacheDir, `${cacheKey}.data`);

	if (!existsSync(metaPath) || !existsSync(dataPath)) return null;

	try {
		const meta: CacheMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));

		const buffer = readFileSync(dataPath);

		return { buffer, meta };
	} catch {
		return null;
	}
};

export const tryLoadSharp = async () => {
	if (sharpLoaded) return sharpModule;

	sharpLoaded = true;

	try {
		// Resolve sharp from the user's project root (not from absolutejs source,
		// which is baked into import.meta paths at bundle time)
		const sharpPath = resolve(process.cwd(), 'node_modules/sharp');

		const mod = await import(sharpPath);

		sharpModule = mod.default ?? mod;

		return sharpModule;
	} catch {
		if (sharpWarned) return null;

		sharpWarned = true;

		console.warn(
			'[image] AVIF requested but sharp not installed and Bun.Image cannot encode AVIF on this platform. ' +
				'Install sharp (`bun add sharp`) to enable AVIF, or remove "avif" from your image formats config. ' +
				'See docs/SHARP_REMOVAL.md for context.'
		);

		return null;
	}
};

export const writeToCache = (
	cacheDir: string,
	cacheKey: string,
	buffer: Buffer,
	meta: CacheMeta
) => {
	const metaPath = join(cacheDir, `${cacheKey}.meta`);

	const dataPath = join(cacheDir, `${cacheKey}.data`);

	writeFileSync(dataPath, buffer);

	writeFileSync(metaPath, JSON.stringify(meta));
};

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
	ImageConfig,
	ImageFormat,
	RemotePattern
} from '../../types/image';

// ── Constants ──────────────────────────────────────────────────────

/* eslint-disable no-magic-numbers */
export const DEFAULT_DEVICE_SIZES = [
	640, 750, 828, 1080, 1200, 1920, 2048, 3840
];

export const DEFAULT_IMAGE_SIZES = [16, 32, 48, 64, 96, 128, 256, 384];

export const DEFAULT_QUALITY = 75;
/* eslint-enable no-magic-numbers */

export const OPTIMIZATION_ENDPOINT = '/_absolute/image';

// ── Blur Placeholder ───────────────────────────────────────────────

const BLUR_SIZE = 8;
const BLUR_QUALITY = 70;
const BLUR_DEVIATION = 20;

// ── Sharp Loading ──────────────────────────────────────────────────

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
		const prefix = pattern.slice(0, -2); // eslint-disable-line no-magic-numbers

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

/** Convert sharp dynamic import result to a callable factory */
const callSharp = (sharpRef: unknown, input: Buffer) => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions -- sharp is dynamically imported
	const factory = sharpRef as any;

	return factory(input);
};

const toBuffer = (input: Buffer | ArrayBuffer) => {
	if (Buffer.isBuffer(input)) return input;

	return Buffer.from(input);
};

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
	const sharp = await tryLoadSharp();

	if (!sharp) return '';

	const tiny: Buffer = await callSharp(sharp, toBuffer(buffer))
		.resize(BLUR_SIZE, BLUR_SIZE, { fit: 'inside' })
		.webp({ quality: BLUR_QUALITY })
		.toBuffer();

	return `data:image/webp;base64,${tiny.toString('base64')}`;
};

export const generateBlurSvg = (base64Thumbnail: string) => {
	// Match Next.js: wrap tiny thumbnail in SVG with Gaussian blur
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><filter id="b" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${BLUR_DEVIATION}"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 100 -1"/></filter><image filter="url(#b)" x="0" y="0" width="100%" height="100%" href="${base64Thumbnail}"/></svg>`;

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

export const optimizeImage = async (
	buffer: Buffer | ArrayBuffer,
	width: number,
	quality: number,
	format: ImageFormat
) => {
	const sharp = await tryLoadSharp();

	if (!sharp) return toBuffer(buffer);

	const pipeline = callSharp(sharp, toBuffer(buffer))
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
		default:
			return toBuffer(buffer);
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
			'[image] sharp not installed — serving unoptimized images. Install with: bun add sharp'
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

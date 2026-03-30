/**
 * Client-safe image utilities — no node:fs, no Sharp, no Bun APIs.
 * These can be imported in both server and client (browser) contexts.
 */

export type { ImageProps } from '../../types/image';

/* eslint-disable no-magic-numbers */
export const DEFAULT_DEVICE_SIZES = [
	640, 750, 828, 1080, 1200, 1920, 2048, 3840
];

export const DEFAULT_IMAGE_SIZES = [16, 32, 48, 64, 96, 128, 256, 384];

export const DEFAULT_QUALITY = 75;
/* eslint-enable no-magic-numbers */

export const OPTIMIZATION_ENDPOINT = '/_absolute/image';

export const buildOptimizedUrl = (
	src: string,
	width: number,
	quality: number,
	basePath = OPTIMIZATION_ENDPOINT
) => `${basePath}?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;

export const getAllSizes = (deviceSizes?: number[], imageSizes?: number[]) => {
	const device = deviceSizes ?? DEFAULT_DEVICE_SIZES;

	const image = imageSizes ?? DEFAULT_IMAGE_SIZES;

	return [...device, ...image].sort((left, right) => left - right);
};

/** Snap a target width UP to the nearest configured size */
const snapToSize = (target: number, sizes: number[]) => {
	for (const size of sizes) {
		if (size >= target) return size;
	}

	return sizes[sizes.length - 1] ?? target;
};

export const generateSrcSet = (
	src: string,
	width: number | undefined,
	sizes: string | undefined,
	deviceSizes?: number[],
	imageSizes?: number[]
) => {
	const quality = DEFAULT_QUALITY;

	if (sizes) {
		const allSizes = getAllSizes(deviceSizes, imageSizes);

		return allSizes
			.map(
				(sizeWidth) =>
					`${buildOptimizedUrl(src, sizeWidth, quality)} ${sizeWidth}w`
			)
			.join(', ');
	}

	if (width) {
		const allSizes = getAllSizes(deviceSizes, imageSizes);

		const w1x = snapToSize(width, allSizes);

		const w2x = snapToSize(width * 2, allSizes); // eslint-disable-line no-magic-numbers

		return `${buildOptimizedUrl(src, w1x, quality)} 1x, ${buildOptimizedUrl(src, w2x, quality)} 2x`;
	}

	const devSizes = deviceSizes ?? DEFAULT_DEVICE_SIZES;

	return devSizes
		.map(
			(sizeWidth) =>
				`${buildOptimizedUrl(src, sizeWidth, quality)} ${sizeWidth}w`
		)
		.join(', ');
};

export const generateBlurSvg = (base64Thumbnail: string) => {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><filter id="b" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="20"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 100 -1"/></filter><image filter="url(#b)" x="0" y="0" width="100%" height="100%" href="${base64Thumbnail}"/></svg>`;

	const encoded = encodeURIComponent(svg);

	return `url("data:image/svg+xml,${encoded}")`;
};

import { readFile, writeFile } from 'node:fs/promises';
import {
	DEFAULT_QUALITY,
	OPTIMIZATION_ENDPOINT,
	buildOptimizedUrl,
	getAllSizes
} from '../utils/imageProcessing';
import { scanEntryPoints } from './scanEntryPoints';
import type { ImageConfig } from '../../types/image';

/**
 * Build-time transform for HTML files: finds `<img data-optimized ...>` tags
 * and rewrites them to use the optimization endpoint with responsive srcset.
 *
 * Example input:
 *   <img data-optimized src="/photos/hero.jpg" width="1200" height="800"
 *        sizes="(max-width: 768px) 100vw, 50vw" alt="Hero">
 *
 * Output:
 *   <img src="/_absolute/image?url=...&w=1200&q=75"
 *        srcset="/_absolute/image?url=...&w=640&q=75 640w, ..."
 *        sizes="(max-width: 768px) 100vw, 50vw"
 *        width="1200" height="800" alt="Hero"
 *        loading="lazy" decoding="async">
 */

const IMG_REGEX = /<img\s+([^>]*?)data-optimized([^>]*?)\/?>/gi;

const getAttr = (attrs: string, name: string) => {
	const regex = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');

	const match = regex.exec(attrs);

	return match ? match[1] : undefined;
};

const removeAttr = (attrs: string, name: string) =>
	attrs.replace(new RegExp(`\\s*${name}\\s*=\\s*["'][^"']*["']`, 'gi'), '');

const transformImgTag = (fullMatch: string, before: string, after: string, config?: ImageConfig) => {
	const attrs = before + after;

	const src = getAttr(attrs, 'src');

	if (!src) return fullMatch;

	const widthStr = getAttr(attrs, 'width');

	const sizes = getAttr(attrs, 'sizes');

	const quality = config?.quality ?? DEFAULT_QUALITY;

	const basePath = config?.path ?? OPTIMIZATION_ENDPOINT;

	const width = widthStr ? parseInt(widthStr, 10) : undefined;

	// Build optimized src
	const optimizedSrc = buildOptimizedUrl(src, width ?? 0, quality, basePath);

	// Build srcset
	let srcset: string;

	if (sizes) {
		const allSizes = getAllSizes(config);

		srcset = allSizes
			.map((sizeWidth) => `${buildOptimizedUrl(src, sizeWidth, quality, basePath)} ${sizeWidth}w`)
			.join(', ');
	} else if (width) {
		// 1x and 2x density descriptors
		const allSizes = getAllSizes(config);

		const w1x = snapUp(width, allSizes);

		const w2x = snapUp(width * 2, allSizes);

		srcset = `${buildOptimizedUrl(src, w1x, quality, basePath)} 1x, ${buildOptimizedUrl(src, w2x, quality, basePath)} 2x`;
	} else {
		const deviceSizes = config?.deviceSizes ?? [640, 750, 828, 1080, 1200, 1920, 2048, 3840]; // eslint-disable-line no-magic-numbers

		srcset = deviceSizes
			.map((sizeWidth) => `${buildOptimizedUrl(src, sizeWidth, quality, basePath)} ${sizeWidth}w`)
			.join(', ');
	}

	// Clean original attributes — remove data-optimized and src (we'll re-add them)
	let cleanAttrs = removeAttr(attrs, 'data-optimized');

	cleanAttrs = removeAttr(cleanAttrs, 'src');

	// Remove loading/decoding if present (we'll set our own)
	cleanAttrs = removeAttr(cleanAttrs, 'loading');

	cleanAttrs = removeAttr(cleanAttrs, 'decoding');

	cleanAttrs = cleanAttrs.trim();

	const resolvedSizes = sizes ?? (width ? undefined : '100vw');

	const sizesAttr = resolvedSizes ? ` sizes="${resolvedSizes}"` : '';

	return `<img src="${optimizedSrc}" srcset="${srcset}"${sizesAttr} ${cleanAttrs} loading="lazy" decoding="async">`;
};

const snapUp = (target: number, sizes: number[]) => {
	for (const size of sizes) {
		if (size >= target) return size;
	}

	return sizes[sizes.length - 1] ?? target;
};

export const optimizeHtmlImages = async (
	directory: string,
	config?: ImageConfig
) => {
	const htmlFiles = await scanEntryPoints(directory, '*.html');

	const tasks = htmlFiles.map(async (filePath) => {
		const original = await readFile(filePath, 'utf8');

		if (!original.includes('data-optimized')) return;

		const updated = original.replace(
			IMG_REGEX,
			(match, before, after) => transformImgTag(match, before, after, config)
		);

		if (updated !== original) {
			await writeFile(filePath, updated, 'utf8');
		}
	});

	await Promise.all(tasks);
};

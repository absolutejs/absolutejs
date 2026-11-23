/* Blur placeholders for build-time images.
 *
 * `types/image.ts` has always said `blurDataURL` is "auto-generated for
 * build-time images". Nothing generated it: `generateBlurDataURL` existed
 * with no caller anywhere, so `placeholder="blur"` resolved to `undefined`
 * and the prop was accepted and silently did nothing unless the project
 * computed a base64 thumbnail itself and passed it in.
 *
 * Generation is cheap enough not to think about: measured on a 427KB PNG,
 * one blur is 255 bytes and takes 3.2ms steady-state, so a hundred images
 * cost about a third of a second of build time.
 *
 * Delivery is the part with a real cost, and this is why the map is
 * FILTERED PER PAGE rather than shipped whole. The browser manifest that
 * already rides every page carries the whole app's entries; doing the same
 * here would put 255 bytes times every image in the project into every
 * page's HTML, whether that page shows them or not — 25KB a page at a
 * hundred images, and base64 webp barely compresses. A blur exists to
 * cover the moment before an image paints, so the only entries a page
 * needs are the ones it actually renders. `blurPlaceholdersForHtml` picks
 * those out of the rendered HTML, which is a pure function of a string:
 * no per-request collection, and nothing for two concurrent renders to
 * interleave. */

import { readdir } from 'node:fs/promises';
import { extname, join, posix, sep } from 'node:path';
import { generateBlurDataURL } from '../utils/imageProcessing';

/** What `new Bun.Image` can decode and is worth blurring. SVG is excluded
 *  deliberately: it is already tiny and resolution-independent, so a raster
 *  thumbnail of one is bigger than the thing it stands in for. */
const BLURRABLE = new Set(['.avif', '.jpeg', '.jpg', '.png', '.webp']);

/** Blurring a huge source costs decode time for an 8x8 result, and a file
 *  this big is usually a mistake worth leaving alone rather than paying
 *  for on every build. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export type BlurPlaceholders = Record<string, string>;

const publicPath = (root: string, file: string) =>
	`/${file.slice(root.length).split(sep).join(posix.sep).replace(/^\/+/u, '')}`;

const imagesUnder = async (root: string): Promise<string[]> => {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		/* A directory the project does not have is not an error. */
		return [];
	}
	const found = await Promise.all(
		entries.map(async (entry) => {
			const full = join(root, entry.name);
			if (entry.isDirectory()) return imagesUnder(full);

			return BLURRABLE.has(extname(entry.name).toLowerCase())
				? [full]
				: [];
		})
	);

	return found.flat();
};

/** Generates a blur for every image under `roots`, keyed by the path a page
 *  would reference it as. A file that cannot be decoded is skipped rather
 *  than failing the build: a placeholder is not worth a failed deploy. */
export const generateBlurPlaceholders = async (
	buildPath: string,
	roots: readonly string[]
) => {
	const placeholders: BlurPlaceholders = {};
	const files = (
		await Promise.all(roots.map((root) => imagesUnder(root)))
	).flat();

	await Promise.all(
		files.map(async (file) => {
			try {
				const handle = Bun.file(file);
				if (handle.size > MAX_SOURCE_BYTES) return;
				placeholders[publicPath(buildPath, file)] =
					await generateBlurDataURL(await handle.arrayBuffer());
			} catch {
				/* Unreadable or undecodable: no placeholder for that one. */
			}
		})
	);

	return placeholders;
};

/* `src="/assets/png/hero.png"`, and the same in single quotes. Matching the
 * rendered HTML rather than tracking what the components resolved keeps
 * this a pure function of the page. */
const SRC_ATTRIBUTE = /\ssrc=["']([^"']+)["']/gu;

/** The entries a page actually needs: those whose path appears as a `src`
 *  in the HTML it is about to send. An optimized `src` points at the image
 *  endpoint with the original in a query parameter, so the raw path is
 *  looked for anywhere in the attribute rather than compared whole. */
export const blurPlaceholdersForHtml = (
	html: string,
	placeholders: BlurPlaceholders
) => {
	const entries = Object.entries(placeholders);
	if (entries.length === 0) return {};
	const sources = [...html.matchAll(SRC_ATTRIBUTE)].map(
		(match) => match[1] ?? ''
	);
	if (sources.length === 0) return {};

	const used: BlurPlaceholders = {};
	for (const [path, dataUrl] of entries) {
		const encoded = encodeURIComponent(path);
		if (
			sources.some(
				(source) => source.includes(path) || source.includes(encoded)
			)
		)
			used[path] = dataUrl;
	}

	return used;
};

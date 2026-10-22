/* The path part of a `/@src/` module URL, relative to the app's folder.
 *
 * A file outside that folder -- a workspace package's source, or a
 * node_modules hoisted to the workspace root -- is `../` from the app, and a
 * browser collapses `/@src/../core/x.ts` to `/core/x.ts` before it ever asks
 * for it: the module 404s and the page never hydrates. Each leading step up
 * is written `@up` instead, which a browser leaves alone. */
const UP_SEGMENT = '@up';
const PARENT_SEGMENT = '..';

const mapLeading = (path: string, source: string, target: string) => {
	const segments = path.split('/');
	let index = 0;
	while (segments[index] === source) {
		segments[index] = target;
		index += 1;
	}

	return segments.join('/');
};

/** `@up/core/x.ts` → `../core/x.ts`, for resolving against the app folder. */
export const decodeSrcPath = (srcPath: string) =>
	mapLeading(srcPath, UP_SEGMENT, PARENT_SEGMENT);

/** `../core/x.ts` → `@up/core/x.ts`; a path inside the app is unchanged. */
export const encodeSrcPath = (relativePath: string) =>
	mapLeading(relativePath.replace(/\\/g, '/'), PARENT_SEGMENT, UP_SEGMENT);

import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { Glob } from 'bun';
import type {
	FolderNotFound,
	RouteFolderConventions
} from '../../types/conventions';
import type { FileRouteFramework } from '../../types/fileRoutes';
import { fileRoutePath, fileRouteRootOf, fileRoutesOf } from './fileRoutes';

/* `error` and `not-found` files inside a route folder.
 *
 * `routes/blog/error.tsx` is the error page for every route under
 * `routes/blog/`, and `routes/blog/not-found.tsx` its 404 — the way a
 * `layout` wraps a folder and a `layout.server` guards it, and found the
 * same way: from the route's own folder up to the route root, nearest
 * first. A `(group)` folder takes part like any other, so
 * `(admin)/error.tsx` covers the group's routes and no others.
 *
 * Two things come out of a framework's route folder:
 *
 * - FOR EACH ROUTE, the nearest `error` and `not-found` above it. That
 *   is what a route shows when its `load` or its render throws, or when
 *   its `load` throws `NotFound`.
 * - FOR EACH FOLDER with a `not-found`, the address it stands for. That
 *   is for the other kind of 404, an address under `/blog/` that no
 *   route answers: there is no route to ask, only a path to compare.
 *   A `(group)` adds nothing to an address, so a `not-found` inside one
 *   has no path of its own to answer for and is left out of this list;
 *   it still serves its group's routes through the first.
 *
 * Paths here are source files. The build compiles or copies them and
 * rewrites these to what it produced, as it does for the conventions in
 * a `pages/` folder. */

const EXTENSIONS: Record<FileRouteFramework, readonly string[]> = {
	angular: ['.ts'],
	html: ['.html'],
	htmx: ['.html'],
	react: ['.tsx', '.jsx'],
	svelte: ['.svelte'],
	vue: ['.vue']
};

const GROUP_RE = /^\(.+\)$/;

type Kind = 'error' | 'not-found';

const fileIn = (dir: string, kind: Kind, extensions: readonly string[]) =>
	extensions
		.map((extension) => join(dir, `${kind}${extension}`))
		.find((candidate) => existsSync(candidate));

/* From `dir` up to `rootDir`, the first folder that has one. */
const nearest = (
	rootDir: string,
	dir: string,
	kind: Kind,
	extensions: readonly string[]
): string | undefined => {
	const found = fileIn(dir, kind, extensions);
	if (found || dir === rootDir || !dir.startsWith(rootDir)) return found;

	return nearest(rootDir, dirname(dir), kind, extensions);
};

const toPosix = (path: string) => path.split(sep).join('/');

const isPrivate = (segment: string) =>
	segment.startsWith('_') || segment.startsWith('.');

/* The addresses a folder stands for, as the routes in it are addressed:
 * `blog/[slug]` is `/blog/:slug`. None for a folder inside a `(group)`
 * or a private folder, or one whose name is not a route segment. */
const pathsOfFolder = (
	framework: FileRouteFramework,
	folder: string,
	extension: string
) => {
	const segments = folder === '' ? [] : folder.split('/');
	if (
		segments.some((segment) => GROUP_RE.test(segment) || isPrivate(segment))
	)
		return [];
	const mapped = fileRoutePath(
		framework,
		[...segments, `index${extension}`].join('/')
	);

	return 'error' in mapped ? [] : mapped.paths;
};

const notFoundFiles = (rootDir: string, extension: string) =>
	Array.fromAsync(
		new Glob(`**/not-found${extension}`).scan({
			absolute: true,
			cwd: rootDir
		})
	);

const foldersWithNotFound = async (
	framework: FileRouteFramework,
	rootDir: string
) => {
	const perExtension = await Promise.all(
		EXTENSIONS[framework].map(async (extension) =>
			(await notFoundFiles(rootDir, extension)).flatMap((file) =>
				pathsOfFolder(
					framework,
					toPosix(relative(rootDir, dirname(file))),
					extension
				).map((path): FolderNotFound => ({ notFound: file, path }))
			)
		)
	);

	return perExtension
		.flat()
		.sort((left, right) => left.path.localeCompare(right.path));
};

export type ScannedRouteFolderConventions = {
	folders: FolderNotFound[];
	/** By route page name. */
	routes: Record<string, RouteFolderConventions>;
};

/** What a framework's route folder holds, from the last route scan;
 *  undefined when file routing is off for it or it has none. */
export const scanRouteFolderConventions = async (
	framework: FileRouteFramework
) => {
	const rootDir = fileRouteRootOf(framework);
	if (!rootDir || !existsSync(rootDir)) return undefined;
	const extensions = EXTENSIONS[framework];
	const routes: Record<string, RouteFolderConventions> = {};
	for (const route of fileRoutesOf(framework)) {
		const dir = dirname(route.source);
		const error = nearest(rootDir, dir, 'error', extensions);
		const notFound = nearest(rootDir, dir, 'not-found', extensions);
		if (error || notFound)
			routes[route.name] = {
				...(error ? { error } : {}),
				...(notFound ? { notFound } : {})
			};
	}
	const folders = await foldersWithNotFound(framework, rootDir);
	if (folders.length === 0 && Object.keys(routes).length === 0)
		return undefined;
	const scanned: ScannedRouteFolderConventions = { folders, routes };

	return scanned;
};

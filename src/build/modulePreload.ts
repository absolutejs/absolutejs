/* Which modules a page's entry will pull in, so they can be preloaded.
 *
 * A browser discovers a module graph by walking it: it fetches the entry,
 * parses it, finds its imports, fetches those, parses them, and so on. Each
 * level is a round trip that cannot start until the one above it finishes.
 *
 * Measured on the example app's built output, a React page's hydration
 * entry statically imports five modules (the shared chunk, react,
 * react-dom, react-dom/client, the jsx runtime), and `react-dom_client`
 * itself imports three more chunks. So the code a page needs sits three
 * levels deep and costs two round trips after the HTML, with nothing in
 * the markup to start them earlier.
 *
 * `<link rel="modulepreload">` for the whole graph collapses that: every
 * file starts downloading while the HTML is still parsing.
 *
 * The graph is computed at build time by reading the emitted JavaScript,
 * because that is the only place it is actually known — the bundler's
 * chunking decides it, and a specifier in the source does not say which
 * chunk it ends up in. */

import { readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

/* Static imports and re-exports only, written to match EMITTED code
 * rather than source: the bundler minifies, so there is no space in
 * `}from"./chunk.js"` and a pattern expecting one finds nothing. The
 * first attempt here did exactly that and returned an empty graph
 * against the real build.
 *
 * A dynamic `import()` is deliberately NOT followed: it is code the page
 * has said it does not need yet, and preloading it would spend the
 * bandwidth this exists to save. The parenthesis keeps it out of the
 * second pattern. */
const FROM_SPECIFIER = /\bfrom\s*["']([^"']+)["']/gu;
const BARE_IMPORT = /\bimport\s*["']([^"']+)["']/gu;

const MAX_GRAPH = 200;

const toPublicUrl = (buildPath: string, file: string) =>
	`/${relative(buildPath, file).split(sep).join(posix.sep)}`;

const specifiersIn = (source: string) =>
	[...source.matchAll(FROM_SPECIFIER), ...source.matchAll(BARE_IMPORT)]
		.map((match) => match[1] ?? '')
		.filter((specifier) => specifier.length > 0);

/** Resolves one specifier to a file inside the build, or null for anything
 *  that is not: a bare package name, a remote URL, a data: URI. */
const resolveSpecifier = (
	buildPath: string,
	fromFile: string,
	specifier: string
) => {
	if (specifier.startsWith('/')) {
		const candidate = join(buildPath, specifier);

		return candidate.startsWith(buildPath) ? candidate : null;
	}
	if (!specifier.startsWith('.')) return null;
	const candidate = resolve(dirname(fromFile), specifier);

	return candidate.startsWith(buildPath) ? candidate : null;
};

const readModule = (file: string) => {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		/* An import that resolves to nothing on disk is not worth
		 * failing a build over; it just does not get preloaded. */
		return null;
	}
};

/** The files inside the build that `file` imports, in source order. */
const importsOf = (root: string, file: string) => {
	const source = readModule(file);
	if (source === null) return [];

	return [...specifiersIn(source)]
		.map((specifier) => resolveSpecifier(root, file, specifier))
		.filter((resolved) => resolved !== null);
};

/** Every module the entry will load, in breadth-first order, as public
 *  URLs. The entry itself is not included: the page already has a script
 *  tag for it, and preloading what is already being fetched is waste. */
export const moduleGraphFor = (buildPath: string, entryFile: string) => {
	const root = resolve(buildPath);
	const seen = new Set<string>([resolve(entryFile)]);
	const graph: string[] = [];
	let frontier = [resolve(entryFile)];

	while (frontier.length > 0 && graph.length < MAX_GRAPH) {
		const next: string[] = [];
		frontier
			.flatMap((file) => importsOf(root, file))
			.forEach((resolved) => {
				if (seen.has(resolved)) return;
				seen.add(resolved);
				graph.push(toPublicUrl(root, resolved));
				next.push(resolved);
			});
		frontier = next;
	}

	return graph;
};

export type ModulePreloadMap = Record<string, string[]>;

/** The graph for every client entry in the build, keyed by the public URL
 *  the page's script tag uses. Computed once at build time because the
 *  bundler's chunking decides it and reading it per request would be a
 *  file walk on the hot path. */
export const generateModulePreloadMap = (
	buildPath: string,
	entryFiles: readonly string[]
) => {
	const map: ModulePreloadMap = {};
	for (const file of entryFiles) {
		const graph = moduleGraphFor(buildPath, file);
		if (graph.length > 0)
			map[toPublicUrl(resolve(buildPath), file)] = graph;
	}

	return map;
};

/* One `Link` header, not many: a response may carry several and some
 * proxies drop all but the first, so they are joined. */
export const modulePreloadLinkHeader = (urls: readonly string[]) =>
	urls.map((url) => `<${url}>; rel=modulepreload`).join(', ');

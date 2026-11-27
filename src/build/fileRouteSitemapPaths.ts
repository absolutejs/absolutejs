import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BuildConfig } from '../../types/build';
import { logWarn } from '../utils/logger';
import { fillRoutePath } from '../utils/route';
import { mergeRouteMetadata } from '../utils/routeMetadata';
import type { RouteMetadata } from '../../types/routeMetadata';
import { scanFileRoutes } from './fileRoutes';

/* The concrete URLs a project's file routes serve, for the sitemap.
 *
 * The sitemap is built from a static scan of the project's Elysia
 * registrations (`scanRouteRegistrations`), and a file route is not one:
 * `fileRoutes()` registers it at run time from the generated module, so
 * nothing in the source looks like `.get('/blog/:slug', …)`. A project
 * whose pages are all file routes therefore got an EMPTY sitemap, which
 * is what this fixes — measured on the file-routes fixture, 20-odd routes
 * and `<urlset></urlset>`.
 *
 * A static route is its own URL. A dynamic one cannot be enumerated from
 * its file name — `blog/[slug].tsx` says nothing about which slugs exist
 * — so its server module may export `entries()` returning the param sets,
 * and each becomes a URL. A dynamic route without `entries()` is left
 * out: a sitemap missing a URL is a worse sitemap, but a sitemap
 * containing `/blog/:slug` is a broken one.
 *
 * `entries()` is called in the build's own process, so a module that
 * throws, or that cannot be imported at all, costs one warning and the
 * rest of the sitemap rather than the build. */

const DYNAMIC_SEGMENT = /[:*]/;

/** Params `entries()` returned, with everything the filler can use. */
const asParams = (value: unknown) => {
	if (typeof value !== 'object' || value === null) return undefined;
	const params: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw === 'string') params[key] = raw;
		else if (typeof raw === 'number') params[key] = String(raw);
	}

	return params;
};

const loadEntries = async (serverModule: string, routePath: string) => {
	let loaded: { entries?: unknown };
	try {
		loaded = await import(resolve(serverModule));
	} catch (error) {
		logWarn(
			`Could not import ${serverModule} to enumerate ${routePath} for the sitemap: ${error instanceof Error ? error.message : String(error)}`
		);

		return undefined;
	}
	if (typeof loaded.entries !== 'function') return undefined;
	try {
		const produced: unknown = await loaded.entries();

		return Array.isArray(produced) ? produced : undefined;
	} catch (error) {
		logWarn(
			`entries() in ${serverModule} threw, so ${routePath} is not in the sitemap: ${error instanceof Error ? error.message : String(error)}`
		);

		return undefined;
	}
};

type ScannedRoute = ReturnType<typeof scanFileRoutes>['routes'][number];

const METADATA_RE = /^[ \t]*export\s+const\s+metadata\b/m;

const mentionsMetadata = (path: string) => {
	try {
		return METADATA_RE.test(readFileSync(path, 'utf8'));
	} catch {
		return false;
	}
};

const isMetadataValue = (value: unknown): value is RouteMetadata =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/* A module's `metadata`, when it is written as a value. One written as
 * a function is worked out per request, from data a build does not
 * have, and is nothing here. A module that cannot be imported costs a
 * warning and is treated as saying nothing. */
const staticMetadataOf = async (path: string) => {
	if (!mentionsMetadata(path)) return [];
	try {
		const loaded: { metadata?: unknown } = await import(resolve(path));
		const { metadata } = loaded;

		return isMetadataValue(metadata) ? [metadata] : [];
	} catch (error) {
		logWarn(
			`Could not import ${path} to read its metadata for the sitemap: ${error instanceof Error ? error.message : String(error)}`
		);

		return [];
	}
};

/* Whether a route asks not to be indexed: `robots: { index: false }`
 * in its `metadata`, or in a folder's above it, merged as they are for
 * the page. A sitemap is the list of pages a site wants found, and
 * listing one that says "do not index me" tells a crawler two things
 * at once.
 *
 * Only metadata written as a value can be known here. A route whose
 * `metadata` is a function stays in the sitemap whatever it would
 * return; leave such a route out with `sitemap.exclude`. */
const asksNotToBeIndexed = async (entry: ScannedRoute) => {
	const modules = [
		...(entry.guards ?? []),
		...(entry.server ? [entry.server] : [])
	];
	const levels = await modules.reduce(
		async (previous, path) => [
			...(await previous),
			...(await staticMetadataOf(path))
		],
		Promise.resolve<RouteMetadata[]>([])
	);

	return mergeRouteMetadata(levels).robots?.index === false;
};

/** The URLs one route serves: itself when it is static, one per param
 *  set its `entries()` returns when it is dynamic. */
const urlsOfRoute = async (entry: ScannedRoute) => {
	if (await asksNotToBeIndexed(entry)) return [];
	const typePath = entry.typePath ?? entry.path;
	if (!DYNAMIC_SEGMENT.test(typePath)) return [entry.path];
	if (!entry.server) return [];
	const { server } = entry;
	const produced = await loadEntries(server, typePath);
	if (!produced) return [];

	return produced.flatMap((params) => {
		const asked = asParams(params);
		if (!asked) return [];
		const filled = fillRoutePath(typePath, asked);
		if (!('missing' in filled)) return [filled.url];
		logWarn(
			`entries() in ${server} returned a set without "${filled.missing}", so one URL of ${typePath} is not in the sitemap.`
		);

		return [];
	});
};

/** Every URL the project's file routes serve that a build can know.
 *
 *  Static routes, plus one URL per param set a dynamic route's
 *  `entries()` returns. Sorted and deduplicated, because an
 *  `[[optional]]` route registers two paths that share one `typePath`. */
export const fileRouteSitemapPaths = async (
	config: BuildConfig,
	projectRoot = process.cwd()
) => {
	const { routes } = scanFileRoutes(config, projectRoot);
	// One route at a time, in order: entries() may read a database, and
	// running every route's at once would open as many connections as the
	// project has dynamic routes.
	const urls = await routes.reduce(
		async (previous, entry) => [
			...(await previous),
			...(await urlsOfRoute(entry))
		],
		Promise.resolve<string[]>([])
	);

	return [...new Set(urls)].sort();
};

import { resolve } from 'node:path';
import type { BuildConfig } from '../../types/build';
import { logWarn } from '../utils/logger';
import { fillRoutePath } from '../utils/route';
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
	const urls: string[] = [];
	for (const entry of routes) {
		const typePath = entry.typePath ?? entry.path;
		if (!DYNAMIC_SEGMENT.test(typePath)) {
			urls.push(entry.path);
			continue;
		}
		if (!entry.server) continue;
		// eslint-disable-next-line no-await-in-loop -- these import and may
		// read a database; running every route's entries() at once would
		// open as many connections as the project has dynamic routes.
		const produced = await loadEntries(entry.server, typePath);
		if (!produced) continue;
		for (const params of produced) {
			const asked = asParams(params);
			if (!asked) continue;
			const filled = fillRoutePath(typePath, asked);
			if ('missing' in filled) {
				logWarn(
					`entries() in ${entry.server} returned a set without "${filled.missing}", so one URL of ${typePath} is not in the sitemap.`
				);
				continue;
			}
			urls.push(filled.url);
		}
	}

	return [...new Set(urls)].sort();
};

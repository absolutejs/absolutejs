import { resolve } from 'node:path';
import type { BuildConfig } from '../../types/build';
import type {
	ExpandStaticRoutes,
	StaticRouteExpansion,
	StaticRouteFailure
} from '../../types/staticRoutes';
import { fillRoutePath } from '../utils/route';
import { scanFileRoutes } from './fileRoutes';

/* `static.routes` patterns: `/blog/:slug` becomes the pages it stands for.
 *
 * `static.routes` listed literal paths, so a dynamic file route could be
 * pre-rendered only by writing out every URL it serves — which the config
 * cannot know — or by `routes: 'all'`, which finds a page only if a link
 * from `/` reaches it. A route's server module can already say which
 * param sets it serves, with `entries()`; the sitemap has read that since
 * beta.287. Here the pre-renderer reads the same thing, so a path with a
 * param in it is replaced by one URL per set.
 *
 * Nothing is skipped quietly. A sitemap missing a URL is a worse sitemap;
 * a pre-render that silently produced no blog pages is a site serving
 * every one of them slower than the config says, with nothing to point at
 * why. Each way a pattern can come to nothing is a failure the CLI prints
 * beside the pre-render's own. */

const DYNAMIC_SEGMENT = /[:*]/;

type ScannedRoute = ReturnType<typeof scanFileRoutes>['routes'][number];

const describe = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const failed = (route: string, reason: string) => {
	const failure: StaticRouteFailure = { reason, route };
	const expansion: StaticRouteExpansion = { failures: [failure], routes: [] };

	return expansion;
};

/* A file route is named by the path its params are typed against —
 * `/docs/:rest` for `[...rest]`, `/shop/:category?` for `[[category]]` —
 * which is the spelling `route()` takes and the one a config should use.
 * The path Elysia registers (`/docs/*`) is accepted too. */
const routeFor = (routes: readonly ScannedRoute[], pattern: string) =>
	routes.find((route) => (route.typePath ?? route.path) === pattern) ??
	routes.find((route) => route.path === pattern);

const asParams = (value: unknown) => {
	if (typeof value !== 'object' || value === null) return undefined;
	const params: Record<string, string> = {};
	Object.entries(value).forEach(([key, raw]) => {
		if (typeof raw === 'string') params[key] = raw;
		else if (typeof raw === 'number') params[key] = String(raw);
	});

	return params;
};

type Loaded = { reason: string } | { sets: unknown[] };

const loadEntries = async (serverModule: string) => {
	const moduleFailure = (reason: string) => {
		const loaded: Loaded = { reason };

		return loaded;
	};
	try {
		const imported: { entries?: unknown } = await import(
			resolve(serverModule)
		);
		if (typeof imported.entries !== 'function')
			return moduleFailure(
				`${serverModule} does not export entries(), so the build cannot know which pages this route serves`
			);
		const produced: unknown = await imported.entries();
		if (!Array.isArray(produced))
			return moduleFailure(
				`entries() in ${serverModule} did not return an array`
			);
		const loaded: Loaded = { sets: produced };

		return loaded;
	} catch (error) {
		return moduleFailure(
			`entries() in ${serverModule} could not be run (${describe(error)})`
		);
	}
};

/* One param set to one URL, or to the reason it has none. */
const urlOfSet = (
	pattern: string,
	typePath: string,
	serverModule: string,
	set: unknown
) => {
	const params = asParams(set);
	const filled = params ? fillRoutePath(typePath, params) : undefined;
	if (filled && !('missing' in filled)) {
		const expansion: StaticRouteExpansion = {
			failures: [],
			routes: [filled.url]
		};

		return expansion;
	}

	return failed(
		pattern,
		filled
			? `entries() in ${serverModule} returned a set without "${filled.missing}"`
			: `entries() in ${serverModule} returned something that is not a set of params`
	);
};

/* An `[[optional]]` route registers two paths that share one typed path,
 * so a folder reaches it twice and would report its failure twice. */
const uniqueFailures = (failures: StaticRouteFailure[]) => {
	const seen = new Set<string>();

	return failures.filter((failure) => {
		const key = `${failure.route}\n${failure.reason}`;
		if (seen.has(key)) return false;
		seen.add(key);

		return true;
	});
};

const merge = (parts: readonly StaticRouteExpansion[]) => {
	const merged: StaticRouteExpansion = {
		failures: uniqueFailures(parts.flatMap((part) => part.failures)),
		routes: [...new Set(parts.flatMap((part) => part.routes))]
	};

	return merged;
};

/* The pages one dynamic route serves. `label` is what a failure is
 * filed under: the pattern as the config wrote it, or — for a route
 * reached through a folder — the route's own path. */
const expandRoute = async (route: ScannedRoute, label: string) => {
	if (!route.server)
		return failed(
			label,
			`${route.source} has no server module. Add one that exports entries(), returning the param sets to pre-render`
		);
	const loaded = await loadEntries(route.server);
	if ('reason' in loaded) return failed(label, loaded.reason);
	const typePath = route.typePath ?? route.path;
	const { server } = route;

	return merge(
		loaded.sets.map((set) => urlOfSet(label, typePath, server, set))
	);
};

const expandPattern = async (
	routes: readonly ScannedRoute[],
	pattern: string
) => {
	const route = routeFor(routes, pattern);
	if (!route)
		return failed(
			pattern,
			'no file route has this path. A pattern is filled in from a file route’s entries(); a route registered in server.ts has none, so the build pre-renders none of its pages. List them one by one to pre-render them now, or let revalidatePath create each one'
		);

	return expandRoute(route, pattern);
};

/* `/blog/*`: every file route in a folder.
 *
 * A pattern names one route, so a section of a site was one line per
 * route and a new route in it was rendered per request until someone
 * remembered the config. A path ending in `/*` stands for the folder:
 * its own index, every static route below it as it is, every dynamic
 * one through its `entries()`. A route added to the folder later is
 * covered without the config changing.
 *
 * A dynamic route in the folder that cannot be enumerated is reported
 * under its own path, like a pattern would be: "everything under /shop"
 * that quietly left out the product pages is the failure this whole
 * file exists to prevent. */
const FOLDER_SUFFIX = '/*';

const isFolder = (path: string) => path.endsWith(FOLDER_SUFFIX);

const isUnder = (folder: string, route: ScannedRoute) =>
	route.path === (folder === '' ? '/' : folder) ||
	route.path.startsWith(`${folder}/`);

const expandMember = (route: ScannedRoute) => {
	const typePath = route.typePath ?? route.path;
	if (DYNAMIC_SEGMENT.test(typePath)) return expandRoute(route, typePath);
	const page: StaticRouteExpansion = { failures: [], routes: [route.path] };

	return page;
};

const expandFolder = async (
	routes: readonly ScannedRoute[],
	pattern: string
) => {
	const folder = pattern.slice(0, -FOLDER_SUFFIX.length);
	const members = routes.filter((route) => isUnder(folder, route));
	if (members.length === 0)
		return failed(
			pattern,
			'no file route is under this path. A folder pattern selects file routes; routes registered in server.ts are not part of one'
		);
	// In order, one at a time, for the reason patterns are: entries()
	// may read a database.
	const parts = await members.reduce(
		async (previous, route) => [
			...(await previous),
			await expandMember(route)
		],
		Promise.resolve<StaticRouteExpansion[]>([])
	);

	return merge(parts);
};

const expandListed = (routes: readonly ScannedRoute[], path: string) => {
	if (isFolder(path)) return expandFolder(routes, path);
	if (DYNAMIC_SEGMENT.test(path)) return expandPattern(routes, path);
	const literal: StaticRouteExpansion = { failures: [], routes: [path] };

	return literal;
};

/** Replaces each pattern in a `static.routes` list with the pages it
 *  stands for: a path with a param by the URLs its file route's
 *  `entries()` returns, a path ending in `/*` by every file route in that
 *  folder. Literal paths pass through untouched, in place; a pattern
 *  that yields nothing is reported in `failures`. */
export const expandStaticRoutes = async (
	config: BuildConfig,
	listed: readonly string[],
	projectRoot = process.cwd()
) => {
	if (!listed.some((path) => DYNAMIC_SEGMENT.test(path))) {
		const untouched: StaticRouteExpansion = {
			failures: [],
			routes: [...listed]
		};

		return untouched;
	}
	const { routes } = scanFileRoutes(config, projectRoot);
	// One pattern at a time, in order: entries() may read a database, and
	// running every route's at once would open a connection per pattern.
	const parts = await listed.reduce(
		async (previous, path) => [
			...(await previous),
			await expandListed(routes, path)
		],
		Promise.resolve<StaticRouteExpansion[]>([])
	);

	return merge(parts);
};

/** The expander a pre-render pass is handed: `static.routes` in, pages
 *  out, with the project's config already bound. */
export const staticRouteExpander = (config: BuildConfig) => {
	const expand: ExpandStaticRoutes = (listed) =>
		expandStaticRoutes(config, listed);

	return expand;
};

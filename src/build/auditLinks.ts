import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { canonicalPathname } from '../i18n/pathnames';
import { localeFromPath, stripLocalePrefix } from '../i18n/routing';
import { join, relative, sep } from 'node:path';
import type { BuildConfig } from '../../types/build';
import { scanFileRoutes } from './fileRoutes';
import {
	scanRouteRegistrations,
	type ExtractedRoute
} from './scanRouteRegistrations';

/* The other half of typed links: catching a dead link written as a
 * literal string.
 *
 * `route()` (utils/route.ts) checks a path the caller passes it, which no
 * type can do for an `<a href="/pricng">` — a template attribute is not a
 * typed position in Svelte, Vue or Angular, and an HTML or HTMX route is
 * not a typed language at all. A scan can read all of them, so the typo
 * `route()` cannot see is caught here instead.
 *
 * WARNS rather than fails, and the reason is in the two false positives
 * this found on the way to existing:
 *
 *   - A link to a static file. `/assets/ico/favicon.ico` is served by the
 *     asset plugin, not by a route, so no route table will ever contain
 *     it. Anything with a file extension is skipped for that reason.
 *   - A link to a route an installed PLUGIN registers. `@absolutejs/auth`
 *     mounts its own routes from inside the package, and a scan of the
 *     project's source cannot see them, so `/auth/sign-in` looks dead and
 *     is not. `links.ignore` is the answer, and the reason this cannot be
 *     an error nobody can turn off.
 *
 * Two earlier versions of the scan were wrong in ways worth recording,
 * because both looked right until measured against the example app:
 * matching any `href=` reported three stylesheet and favicon URLs from
 * `<link rel>` elements, and scanning every file reported hashed CSS
 * paths out of the project's own `build/` output. */

const SKIP_DIRS = new Set([
	'.absolutejs',
	'.generated',
	'.git',
	'.next',
	'.svelte-kit',
	'.vercel',
	'build',
	'compiled',
	'coverage',
	'dist',
	'node_modules',
	'start-build'
]);

const LINK_EXTENSIONS = new Set([
	'.astro',
	'.htm',
	'.html',
	'.jsx',
	'.svelte',
	'.tsx',
	'.vue'
]);

/* An `href` on something that NAVIGATES: `<a>`, `<area>`, or a framework
 * `<Link>`. Not one on `<link rel="stylesheet">` or `<link rel="icon">`,
 * which is what an attribute-only match picks up. The JSX/Svelte brace
 * form is included only for a literal inside it (`href={'/x'}`); an
 * expression is not a literal and is left to `route()`. */
const LINK_HREF_RE =
	/<(?:a|area|Link)\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(['"])([^'"]*)\3\s*\})/g;

/** A link found in the project's source. */
export type FoundLink = {
	/** Project-relative path of the file it was written in. */
	file: string;
	href: string;
	/** 1-based, so an editor can jump to it. */
	line: number;
};

const collectFiles = (dir: string, found: string[]) => {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		const isDirectory = entry.isDirectory();
		if (
			isDirectory &&
			!SKIP_DIRS.has(entry.name) &&
			!entry.name.startsWith('.')
		)
			collectFiles(path, found);
		if (isDirectory) continue;
		const dot = entry.name.lastIndexOf('.');
		if (dot !== -1 && LINK_EXTENSIONS.has(entry.name.slice(dot)))
			found.push(path);
	}
};

const lineOf = (source: string, index: number) =>
	source.slice(0, index).split('\n').length;

const readSource = (file: string) => {
	try {
		return readFileSync(file, 'utf-8');
	} catch {
		return undefined;
	}
};

const linksIn = (projectRoot: string, file: string) => {
	const source = readSource(file);
	if (source === undefined) return [];
	const links: FoundLink[] = [];
	for (const match of source.matchAll(new RegExp(LINK_HREF_RE.source, 'g'))) {
		const href = match[1] ?? match[2] ?? match[4];
		// Not a same-origin path: an absolute URL, a fragment, a
		// `mailto:`, `tel:`, or a relative link whose target depends on
		// the page it is written in.
		if (href === undefined || !href.startsWith('/')) continue;
		// `//host/path` is protocol-relative, so another origin.
		if (href.startsWith('//')) continue;
		links.push({
			file: relative(projectRoot, file).split(sep).join('/'),
			href,
			line: lineOf(source, match.index)
		});
	}

	return links;
};

/** Every literal, same-origin link in the project's source. */
export const collectLinks = (projectRoot: string) => {
	const files: string[] = [];
	collectFiles(projectRoot, files);

	return files.flatMap((file) => linksIn(projectRoot, file));
};
export const knownRoutePaths = (
	config: BuildConfig,
	projectRoot: string,
	registered?: readonly ExtractedRoute[]
) => [
	...new Set([
		...scanFileRoutes(config, projectRoot).routes.map(
			(entry) => entry.path
		),
		...(registered ?? scanRouteRegistrations(projectRoot))
			.filter((entry) => entry.method === 'GET' || entry.method === 'ALL')
			.map((entry) => entry.path)
	])
];
export const pathMatchesPattern = (pattern: string, path: string) => {
	const patternParts = pattern.split('/');
	const pathParts = path.split('/');
	for (const [index, part] of patternParts.entries()) {
		if (part === '*') return true;
		const actual = pathParts[index];
		if (actual === undefined) return false;
		const isParameter = part.startsWith(':');
		if (isParameter && actual === '') return false;
		if (!isParameter && part !== actual) return false;
	}

	return pathParts.length === patternParts.length;
};

const hasFileExtension = (path: string) => {
	const last = path.split('/').pop() ?? '';

	return /\.[A-Za-z0-9]{1,8}$/.test(last);
};

const toIgnoreMatcher = (patterns: readonly string[]) => {
	const prefixes = patterns.map((pattern) =>
		pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
	);

	return (path: string) =>
		patterns.some(
			(pattern, index) =>
				(pattern.endsWith('*') &&
					path.startsWith(prefixes[index] ?? '')) ||
				pattern === path
		);
};

/** A link whose target no route serves. */
export type DeadLink = FoundLink & {
	/** The path without its query or fragment, which is what was checked. */
	path: string;
};

/* A locale's own address for a page, as the path its route is
 * registered at: `/fr/a-propos` is `/fr/about`. */
const routePathOf = (path: string, routing: BuildConfig['i18n']) => {
	if (!routing?.pathnames) return path;
	const locale = localeFromPath(path, routing.locales);
	const written = locale ?? routing.defaultLocale;
	const route = canonicalPathname(
		stripLocalePrefix(path, routing.locales),
		written,
		routing.pathnames
	);
	if (locale === undefined) return route;

	return route === '/' ? `/${locale}` : `/${locale}${route}`;
};

/** Every literal link in the project whose target no route serves.
 *
 *  Skipped, because a route table cannot answer for them: a path with a
 *  file extension (a static file the asset plugin serves) and anything
 *  `links.ignore` names (a plugin's own routes, a path a proxy rewrites). */
export const auditLinks = (
	config: BuildConfig,
	projectRoot = process.cwd(),
	registered?: readonly ExtractedRoute[]
) => {
	const patterns = knownRoutePaths(config, projectRoot, registered);
	const ignored = toIgnoreMatcher(config.links?.ignore ?? []);
	const isServed = (path: string) =>
		patterns.some((pattern) => pathMatchesPattern(pattern, path));

	return collectLinks(projectRoot).flatMap((link) => {
		const path = link.href.split(/[?#]/)[0] ?? link.href;
		if (path === '' || hasFileExtension(path) || ignored(path)) return [];
		// A locale's own address is served by the route it is rewritten
		// to (i18n/pathnames.ts).
		if (isServed(path) || isServed(routePathOf(path, config.i18n)))
			return [];
		const dead: DeadLink = { ...link, path };

		return [dead];
	});
};

/** The warning for a set of dead links, or null when there are none. */
export const deadLinkWarning = (dead: readonly DeadLink[]) => {
	if (dead.length === 0) return null;
	const lines = dead.map(
		(link) => `  ${link.file}:${link.line} → ${link.href}`
	);

	const subject =
		dead.length === 1 ? '1 link points' : `${dead.length} links point`;

	return [
		`${subject} at a path no route serves:`,
		...lines,
		'A plugin that registers its own routes is invisible to this check; name those paths in `links.ignore` to silence them.'
	].join('\n');
};

const SAMPLE_VALUE = 'x';

const sampleOf = (pattern: string) =>
	pattern
		.split('/')
		.map((part) => (part.startsWith(':') ? SAMPLE_VALUE : part))
		.join('/');

/** The paths `i18n.pathnames` translates that no route is registered
 *  at, with or without a locale segment in front: a route that was
 *  renamed and left its translations behind. */
export const unservedPathnames = (
	config: BuildConfig,
	projectRoot = process.cwd(),
	registered?: readonly ExtractedRoute[]
) => {
	const routing = config.i18n;
	if (!routing?.pathnames) return [];
	const patterns = knownRoutePaths(config, projectRoot, registered);
	const isServed = (path: string) =>
		patterns.some((pattern) => pathMatchesPattern(pattern, path));

	return Object.keys(routing.pathnames).filter((path) => {
		const sample = sampleOf(path);
		const prefixed =
			sample === '/' ? `/${SAMPLE_VALUE}` : `/${SAMPLE_VALUE}${sample}`;

		return !isServed(sample) && !isServed(prefixed);
	});
};

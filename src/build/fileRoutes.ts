import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep
} from 'node:path';
import { Glob } from 'bun';
import type { BuildConfig } from '../../types/build';
import type {
	FileRouteFramework,
	FileRoutesConfig
} from '../../types/fileRoutes';

/* File-system routing, build side (see docs/FILE_ROUTER_PLAN.md).
 *
 * Route files live under `<frameworkDirectory>/<directory>/` (default
 * `routes`). Each one is a page with a flat, unique page name derived from
 * its path (`RouteBlogSlug<hash>`), so the rest of the build — index
 * generation, Svelte compilation, the manifest, on-demand dev builds — treats
 * it like a page in `pages/`. This module scans the route folders, maps
 * paths to Elysia routes, and writes the route module the server imports. */

export type FileRouteRoot = {
	dir: string;
	framework: FileRouteFramework;
};

export type ScannedFileRoute = {
	framework: FileRouteFramework;
	/** Flat page name: the manifest holds `<name>Index`, `<name>`, … */
	name: string;
	/** Elysia path, e.g. `/blog/:slug`. */
	path: string;
	/** Route file, absolute. */
	source: string;
	/** The name a `[...catchAll]` segment declared; the runtime copies
	 *  Elysia's `*` param onto it. */
	catchAll?: string;
	/** Co-located `<route>.server.ts`, absolute, when present. */
	server?: string;
	/** The path the route's types are written against: a catch-all appears
	 *  under its declared name and an optional segment is marked `?`, so
	 *  `/docs/[...rest]` types as `/docs/:rest` while registering
	 *  `/docs/*`. Defaults to `path` for a route with neither. */
	typePath?: string;
};

export type FileRouteScan = {
	/** Unsupported or conflicting route files, one message each. */
	problems: string[];
	routes: ScannedFileRoute[];
};

type ResolvedFileRoutes = {
	output: string;
	roots: FileRouteRoot[];
};

const DEFAULT_DIRECTORY = 'routes';
const DEFAULT_OUTPUT = join('src', 'routes.gen.ts');
const HASH_LENGTH = 6;
const HASH_RADIX = 36;
const PAGE_GLOBS: Record<FileRouteFramework, string> = {
	react: '**/*.{tsx,jsx}',
	svelte: '**/*.svelte'
};
const PAGE_EXTENSIONS: Record<FileRouteFramework, readonly string[]> = {
	react: ['.tsx', '.jsx'],
	svelte: ['.svelte']
};
const SERVER_EXTENSIONS = ['.server.ts', '.server.js'];
const CONVENTION_RE = /^(?:.+\.)?(?:error|loading|not-found)\.[^.]+$/;
const TEST_RE = /\.(?:test|spec)\.[^.]+$/;
const PARAM_RE = /^\[([A-Za-z_$][\w$]*)\]$/;
const CATCH_ALL_RE = /^\[\.\.\.([A-Za-z_$][\w$]*)\]$/;
const OPTIONAL_RE = /^\[\[([A-Za-z_$][\w$]*)\]\]$/;
const OPTIONAL_CATCH_ALL_RE = /^\[\[\.\.\.([A-Za-z_$][\w$]*)\]\]$/;
const GROUP_RE = /^\(([A-Za-z0-9._~-]+)\)$/;
const STATIC_SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;

const REGISTRY_KEY = Symbol.for('absolutejs.fileRoutes.registry');

type FileRouteRegistry = {
	bySource: Map<string, ScannedFileRoute>;
	roots: FileRouteRoot[];
};

const isRegistry = (value: unknown): value is FileRouteRegistry =>
	typeof value === 'object' &&
	value !== null &&
	'bySource' in value &&
	value.bySource instanceof Map &&
	'roots' in value &&
	Array.isArray(value.roots);

/* One registry per process, shared by every bundled copy of this module
 * (dist/index.js and dist/build.js each inline it). */
const registry = () => {
	const existing = Reflect.get(globalThis, REGISTRY_KEY);
	if (isRegistry(existing)) return existing;
	const created: FileRouteRegistry = { bySource: new Map(), roots: [] };
	Reflect.set(globalThis, REGISTRY_KEY, created);

	return created;
};

const toPosix = (path: string) => path.split(sep).join('/');

const optionsOf = (config: BuildConfig) => {
	const { fileRoutes } = config;
	if (!fileRoutes) return undefined;
	const options: FileRoutesConfig = fileRoutes === true ? {} : fileRoutes;

	return options;
};

/** The route folders and output module for `config`, or `undefined` when
 *  file routing is off. */
export const resolveFileRoutes = (
	config: BuildConfig,
	root = process.cwd()
) => {
	const options = optionsOf(config);
	if (!options) return undefined;
	const directory = options.directory ?? DEFAULT_DIRECTORY;
	const roots: FileRouteRoot[] = [];
	if (config.reactDirectory)
		roots.push({
			dir: resolve(root, config.reactDirectory, directory),
			framework: 'react'
		});
	if (config.svelteDirectory)
		roots.push({
			dir: resolve(root, config.svelteDirectory, directory),
			framework: 'svelte'
		});
	const resolved: ResolvedFileRoutes = {
		output: resolve(root, options.output ?? DEFAULT_OUTPUT),
		roots
	};

	return resolved;
};

const pageExtensionOf = (framework: FileRouteFramework, file: string) =>
	PAGE_EXTENSIONS[framework].find((extension) => file.endsWith(extension));

const isIgnoredSegment = (segment: string) =>
	segment.startsWith('_') || segment.startsWith('.');

/** Whether a file under a route folder is a route. Files and folders
 *  starting with `_` are private (components, helpers); error/loading/
 *  not-found conventions, tests and `.server` modules are not routes. */
const isRouteCandidate = (relativePath: string) => {
	const segments = relativePath.split('/');
	const fileName = segments[segments.length - 1] ?? '';

	return (
		!segments.some(isIgnoredSegment) &&
		!CONVENTION_RE.test(fileName) &&
		!TEST_RE.test(fileName) &&
		!fileName.includes('.server.')
	);
};

/* One path segment of a route file, classified.
 *
 * `group` carries no path of its own: `(marketing)/pricing.tsx` serves
 * `/pricing`, which is the point of a group — folders that organise source
 * without appearing in URLs. `optional` is the only kind that produces more
 * than one route from one file. */
type RouteSegment =
	| { kind: 'catchAll'; name: string }
	| { kind: 'group' }
	| { kind: 'optional'; name: string }
	| { kind: 'param'; name: string }
	| { kind: 'static'; value: string };

const segmentOf = (segment: string): RouteSegment | { error: string } => {
	const param = PARAM_RE.exec(segment);
	if (param?.[1]) return { kind: 'param', name: param[1] };
	const catchAll = CATCH_ALL_RE.exec(segment);
	if (catchAll?.[1]) return { kind: 'catchAll', name: catchAll[1] };
	/* Checked before the optional form, since `[[...rest]]` matches neither
	 * the catch-all nor the optional pattern and would otherwise be reported
	 * as "characters a path segment cannot hold", which says nothing about
	 * what is wrong with it. */
	if (OPTIONAL_CATCH_ALL_RE.test(segment)) {
		return {
			error: `"${segment}" is an optional catch-all, which is not supported. Use "${segment.slice(1, -1)}" and give the parent folder its own route file if the shorter path needs one.`
		};
	}
	const optional = OPTIONAL_RE.exec(segment);
	if (optional?.[1]) return { kind: 'optional', name: optional[1] };
	const group = GROUP_RE.exec(segment);
	if (group) return { kind: 'group' };
	if (segment.startsWith('[') || segment.startsWith('(')) {
		return {
			error: `"${segment}" is not a segment this router understands. Use [param], [...catchAll], [[optional]] or (group).`
		};
	}
	if (!STATIC_SEGMENT_RE.test(segment)) {
		return {
			error: `"${segment}" has characters a URL path segment cannot hold unescaped.`
		};
	}

	return { kind: 'static', value: segment };
};

/* The Elysia path pieces an optional segment expands to: present, and
 * absent. Several optional segments multiply, which is why this returns a
 * list of paths rather than one. */
const expandSegment = (segment: RouteSegment): (string | null)[] => {
	if (segment.kind === 'group') return [null];
	if (segment.kind === 'static') return [segment.value];
	if (segment.kind === 'param') return [`:${segment.name}`];
	if (segment.kind === 'catchAll') return ['*'];

	return [`:${segment.name}`, null];
};

/* The path used for TYPING the route, which is not the path it is
 * registered under. Elysia names a catch-all `*`, but the file declared a
 * name for it (`[...rest]`) and `params.rest` is what the route's `load`
 * reads — so the type carries `:rest` and the runtime maps `*` onto it. An
 * optional segment is typed `:name?`, which `FileRouteParams` reads as an
 * optional key. */
const typeSegment = (segment: RouteSegment) => {
	if (segment.kind === 'group') return null;
	if (segment.kind === 'static') return segment.value;
	if (segment.kind === 'optional') return `:${segment.name}?`;

	return `:${segment.name}`;
};

const stripPageExtension = (
	framework: FileRouteFramework,
	relativePath: string
) => {
	const extension = pageExtensionOf(framework, relativePath) ?? '';

	return relativePath.slice(0, relativePath.length - extension.length);
};

const joinPath = (parts: (string | null)[]) =>
	`/${parts.filter((part): part is string => part !== null).join('/')}`;

/* Every path the segments serve. One per combination of present and absent
 * optional segments, longest first so the most specific path is registered
 * before the shorter ones it shadows. */
const expandPaths = (segments: RouteSegment[]) => {
	const combinations = segments.reduce<(string | null)[][]>(
		(paths, segment) =>
			paths.flatMap((parts) =>
				expandSegment(segment).map((part) => [...parts, part])
			),
		[[]]
	);
	const unique = [...new Set(combinations.map(joinPath))];

	return unique.sort(
		(left, right) => right.split('/').length - left.split('/').length
	);
};

export type FileRoutePathResult = {
	/** The name a `[...catchAll]` segment declared, when the route has one. */
	catchAll?: string;
	/** Elysia paths to register, most specific first. More than one only
	 *  when the file has an `[[optional]]` segment. */
	paths: string[];
	/** The path the route's types are written against — see `typeSegment`. */
	typePath: string;
};

/** The Elysia paths a route file serves, from its path inside the route
 *  folder: `index` → `/`, `blog/index` → `/blog`, `blog/[slug]` →
 *  `/blog/:slug`, `docs/[...rest]` → `/docs/*`, `(marketing)/pricing` →
 *  `/pricing`, `[[lang]]/about` → `/:lang/about` and `/about`. */
export const fileRoutePath = (
	framework: FileRouteFramework,
	relativePath: string
): FileRoutePathResult | { error: string } => {
	const segments = stripPageExtension(framework, relativePath).split('/');
	const last = segments[segments.length - 1];
	const routeSegments = last === 'index' ? segments.slice(0, -1) : segments;
	const parsed: RouteSegment[] = [];
	for (const segment of routeSegments) {
		const result = segmentOf(segment);
		if ('error' in result) return result;
		parsed.push(result);
	}
	/* A catch-all is Elysia's `*`, which matches the rest of the path and so
	 * can only be last. Anything after it would never be reached, and
	 * silently serving a path the file does not describe is worse than
	 * refusing to build it. */
	const catchAllAt = parsed.findIndex(
		(segment) => segment.kind === 'catchAll'
	);
	if (catchAllAt !== -1 && catchAllAt !== parsed.length - 1) {
		return {
			error: `a [...catchAll] segment matches the rest of the path, so it has to be the last one; "${routeSegments[catchAllAt]}" is followed by ${routeSegments
				.slice(catchAllAt + 1)
				.map((segment) => `"${segment}"`)
				.join(', ')}.`
		};
	}
	/* A group names no segment, so a group FILE would serve its parent
	 * folder's path — the same path as that folder's `index`, reported later
	 * as a conflict with a message about two files serving one path. Saying
	 * what is actually wrong is more use than that. */
	const lastParsed = parsed[parsed.length - 1];
	if (lastParsed?.kind === 'group' && last !== 'index') {
		return {
			error: `"${last}" is a (group), which contributes no path segment — a group names a folder, not a route file. Rename it, or move it into the group folder as "index".`
		};
	}
	const duplicate = parsed
		.flatMap((segment) =>
			segment.kind === 'group' || segment.kind === 'static'
				? []
				: [segment.name]
		)
		.find((name, index, names) => names.indexOf(name) !== index);
	if (duplicate !== undefined) {
		return {
			error: `two segments are both named "${duplicate}"; one would overwrite the other in params.`
		};
	}
	const catchAllSegment = parsed[catchAllAt];
	const result: FileRoutePathResult = {
		...(catchAllSegment?.kind === 'catchAll'
			? { catchAll: catchAllSegment.name }
			: {}),
		paths: expandPaths(parsed),
		typePath: joinPath(parsed.map(typeSegment))
	};

	return result;
};

const pascalSegment = (segment: string) => {
	const words = segment.split(/[^A-Za-z0-9]+/).filter(Boolean);

	return words
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join('');
};

/** A route's page name: `Route` + its path in PascalCase + a short hash of
 *  the framework and file path, so two routes never share a manifest key
 *  (`blog/[slug]` and `blog-slug` both read `BlogSlug`). Letters and digits
 *  only, so every manifest key derivation leaves it unchanged. */
export const fileRoutePageName = (
	framework: FileRouteFramework,
	relativePath: string
) => {
	const stem = stripPageExtension(framework, relativePath);
	const readable = stem.split('/').map(pascalSegment).join('');
	const hash = Bun.hash(`${framework}:${stem}`)
		.toString(HASH_RADIX)
		.slice(-HASH_LENGTH)
		.padStart(HASH_LENGTH, '0');

	return `Route${readable}${hash}`;
};

const findServerModule = (framework: FileRouteFramework, source: string) => {
	const extension = pageExtensionOf(framework, source) ?? extname(source);
	const stem = source.slice(0, source.length - extension.length);

	return SERVER_EXTENSIONS.map((suffix) => `${stem}${suffix}`).find(
		(candidate) => existsSync(candidate)
	);
};

/* One route file, as the routes it serves. More than one only for an
 * `[[optional]]` segment, and they share everything but the path: one page,
 * one manifest entry, one server module, registered twice. */
const routesFromFile = (
	root: FileRouteRoot,
	relativePath: string,
	problems: string[]
) => {
	const source = join(root.dir, relativePath);
	const mapped = fileRoutePath(root.framework, relativePath);
	if ('error' in mapped) {
		problems.push(
			`${toPosix(relative(process.cwd(), source))}: ${mapped.error}`
		);
		const none: ScannedFileRoute[] = [];

		return none;
	}
	const shared = {
		framework: root.framework,
		name: fileRoutePageName(root.framework, relativePath),
		server: findServerModule(root.framework, source),
		source,
		typePath: mapped.typePath,
		...(mapped.catchAll === undefined ? {} : { catchAll: mapped.catchAll })
	};

	return mapped.paths.map((path) => {
		const route: ScannedFileRoute = { ...shared, path };

		return route;
	});
};

const scanRoot = (root: FileRouteRoot, problems: string[]) => {
	if (!existsSync(root.dir)) return [];
	const glob = new Glob(PAGE_GLOBS[root.framework]);
	const files = [...glob.scanSync({ cwd: root.dir })]
		.map(toPosix)
		.filter(isRouteCandidate)
		.sort();

	return files.flatMap((file) => routesFromFile(root, file, problems));
};

const conflictMessage = (route: ScannedFileRoute, existing: ScannedFileRoute) =>
	`${toPosix(relative(process.cwd(), route.source))} and ${toPosix(
		relative(process.cwd(), existing.source)
	)} both serve ${route.path}; keep one.`;

/* The first file for a path wins (frameworks in config order, files in
 * sorted order); every other one is a problem. */
const reportConflicts = (routes: ScannedFileRoute[], problems: string[]) => {
	const byPath = new Map<string, ScannedFileRoute>();
	for (const route of routes) {
		const existing = byPath.get(route.path);
		if (existing) problems.push(conflictMessage(route, existing));
		else byPath.set(route.path, route);
	}

	return [...byPath.values()];
};

const compareRoutes = (left: ScannedFileRoute, right: ScannedFileRoute) =>
	left.path.localeCompare(right.path) ||
	left.framework.localeCompare(right.framework);

const remember = (roots: FileRouteRoot[], routes: ScannedFileRoute[]) => {
	const state = registry();
	state.roots = roots;
	state.bySource = new Map(routes.map((route) => [route.source, route]));
};

/** Scan every route folder. Records the result so the build and the dev
 *  server can map a route file to its page name. */
export const scanFileRoutes = (config: BuildConfig) => {
	const resolved = resolveFileRoutes(config);
	const problems: string[] = [];
	if (!resolved) {
		remember([], []);
		const empty: FileRouteScan = { problems, routes: [] };

		return empty;
	}
	const scanned = resolved.roots.flatMap((root) => scanRoot(root, problems));
	const routes = reportConflicts(scanned, problems).sort(compareRoutes);
	remember(resolved.roots, routes);
	const scan: FileRouteScan = { problems, routes };

	return scan;
};

const quote = (value: string) =>
	`'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const importSpecifier = (outputDir: string, target: string) => {
	const extension = extname(target);
	const keepsExtension = extension === '.svelte';
	const withoutExtension = keepsExtension
		? target
		: target.slice(0, target.length - extension.length);
	const path = toPosix(relative(outputDir, withoutExtension));

	return path.startsWith('.') ? path : `./${path}`;
};

const ADAPTERS: Record<
	FileRouteFramework,
	{ name: string; specifier: string }
> = {
	react: {
		name: 'reactFileRoute',
		specifier: '@absolutejs/absolute/react/server'
	},
	svelte: {
		name: 'svelteFileRoute',
		specifier: '@absolutejs/absolute/svelte/server'
	}
};

const renderRoute = (route: ScannedFileRoute, outputDir: string) => {
	const page = quote(importSpecifier(outputDir, route.source));
	const server = route.server
		? quote(importSpecifier(outputDir, route.server))
		: undefined;
	const serverType = server ? `typeof import(${server})` : 'undefined';
	const source = quote(toPosix(relative(process.cwd(), route.source)));
	/* The type argument is the route's TYPE path, not the path it registers
	 * under: `/docs/*` carries no name for its catch-all, so a `load` typed
	 * against it could not read `params.rest`. They are the same string for
	 * a route with no catch-all and no optional segment. */
	const lines = [
		`\t${ADAPTERS[route.framework].name}<`,
		`\t\t${quote(route.typePath ?? route.path)},`,
		`\t\ttypeof import(${page}),`,
		`\t\t${serverType}`,
		`\t>({`,
		...(route.catchAll ? [`\t\tcatchAll: ${quote(route.catchAll)},`] : []),
		`\t\tname: ${quote(route.name)},`,
		// Svelte pages render from their compiled module in the manifest;
		// importing the `.svelte` source on the server is never needed.
		...(route.framework === 'react'
			? [`\t\tpage: () => import(${page}),`]
			: []),
		`\t\tpath: ${quote(route.path)},`,
		...(server ? [`\t\tserver: () => import(${server}),`] : []),
		// `typePath` sorts last and is only written when it differs, so the
		// comma after `source` belongs to it.
		...(route.typePath && route.typePath !== route.path
			? [
					`\t\tsource: ${source},`,
					`\t\ttypePath: ${quote(route.typePath)}`
				]
			: [`\t\tsource: ${source}`]),
		`\t})`
	];

	return lines.join('\n');
};

/** The route module's source. */
export const renderFileRouteModule = (
	routes: ScannedFileRoute[],
	output: string
) => {
	const outputDir = dirname(output);
	const frameworks = [...new Set(routes.map((route) => route.framework))]
		.sort()
		.map((framework) => ADAPTERS[framework]);
	const imports = [
		`import type { FileRouteDefinition } from '@absolutejs/absolute';`,
		...frameworks.map(
			(adapter) =>
				`import { ${adapter.name} } from '${adapter.specifier}';`
		)
	];
	const body =
		routes.length === 0
			? 'export const routeTree: readonly FileRouteDefinition[] = [];'
			: [
					'export const routeTree: readonly FileRouteDefinition[] = [',
					routes
						.map((route) => renderRoute(route, outputDir))
						.join(',\n'),
					'];'
				].join('\n');

	return [
		'// Generated by AbsoluteJS from your route files (`fileRoutes` in',
		'// absolute.config.ts). Do not edit: it is rewritten whenever a route',
		'// file is added, renamed or removed.',
		...imports,
		'',
		body,
		''
	].join('\n');
};

const writeIfChanged = (path: string, contents: string) => {
	const current = existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
	if (current === contents) return false;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, contents);

	return true;
};

/** Scan the route folders and (re)write the route module when its contents
 *  change. `undefined` when file routing is off. */
export const ensureFileRouteModule = (config: BuildConfig) => {
	try {
		syncFileRoutes(config);
	} catch {
		/* the build reports it */
	}
};
export const syncFileRoutes = (config: BuildConfig) => {
	const resolved = resolveFileRoutes(config);
	if (!resolved) {
		remember([], []);

		return undefined;
	}
	const scan = scanFileRoutes(config);
	const written = writeIfChanged(
		resolved.output,
		renderFileRouteModule(scan.routes, resolved.output)
	);

	return { ...scan, output: resolved.output, written };
};

const rootFor = (source: string) =>
	registry().roots.find((root) => source.startsWith(`${root.dir}${sep}`));

/** The route a source file is, when it is one: from the last scan, or from
 *  its path when it was created since. */
export const fileRouteFor = (source: string) => {
	const absolute = isAbsolute(source) ? source : resolve(source);
	const known = registry().bySource.get(absolute);
	if (known) return known;
	const root = rootFor(absolute);
	if (!root) return undefined;
	const relativePath = toPosix(relative(root.dir, absolute));
	if (!pageExtensionOf(root.framework, relativePath)) return undefined;
	if (!isRouteCandidate(relativePath)) return undefined;

	/* The first of the file's routes. A file with an `[[optional]]` segment
	 * serves several paths, but they share the page name, source and server
	 * module, which is all a caller here asks for — the dev server wants to
	 * know which page a changed file is. */
	return routesFromFile(root, relativePath, [])[0];
};
export const fileRouteNamed = (name: string) =>
	[...registry().bySource.values()].find((route) => route.name === name);
export const fileRoutesOf = (framework: FileRouteFramework) =>
	[...registry().bySource.values()].filter(
		(route) => route.framework === framework
	);
export const isInFileRouteRoot = (path: string) =>
	rootFor(isAbsolute(path) ? path : resolve(path)) !== undefined;

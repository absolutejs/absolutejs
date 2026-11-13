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
	/** Co-located `<route>.server.ts`, absolute, when present. */
	server?: string;
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

const segmentToPath = (segment: string) => {
	const param = PARAM_RE.exec(segment);
	if (param) return { path: `:${param[1]}` };
	if (segment.startsWith('[') || segment.startsWith('(')) {
		return {
			error: `"${segment}" is not supported yet — only static segments and [param] segments are (catch-all, optional and group segments come later).`
		};
	}
	if (!STATIC_SEGMENT_RE.test(segment)) {
		return {
			error: `"${segment}" has characters a URL path segment cannot hold unescaped.`
		};
	}

	return { path: segment };
};

const stripPageExtension = (
	framework: FileRouteFramework,
	relativePath: string
) => {
	const extension = pageExtensionOf(framework, relativePath) ?? '';

	return relativePath.slice(0, relativePath.length - extension.length);
};

/** The Elysia path for a route file's path inside its route folder:
 *  `index` → `/`, `blog/index` → `/blog`, `blog/[slug]` → `/blog/:slug`. */
export const fileRoutePath = (
	framework: FileRouteFramework,
	relativePath: string
) => {
	const segments = stripPageExtension(framework, relativePath).split('/');
	const last = segments[segments.length - 1];
	const routeSegments = last === 'index' ? segments.slice(0, -1) : segments;
	const parts: string[] = [];
	for (const segment of routeSegments) {
		const result = segmentToPath(segment);
		if ('error' in result) return result;
		parts.push(result.path);
	}

	return { path: `/${parts.join('/')}` };
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

const routeFromFile = (
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

		return undefined;
	}
	const route: ScannedFileRoute = {
		framework: root.framework,
		name: fileRoutePageName(root.framework, relativePath),
		path: mapped.path,
		server: findServerModule(root.framework, source),
		source
	};

	return route;
};

const scanRoot = (root: FileRouteRoot, problems: string[]) => {
	if (!existsSync(root.dir)) return [];
	const glob = new Glob(PAGE_GLOBS[root.framework]);
	const files = [...glob.scanSync({ cwd: root.dir })]
		.map(toPosix)
		.filter(isRouteCandidate)
		.sort();

	return files
		.map((file) => routeFromFile(root, file, problems))
		.filter((route): route is ScannedFileRoute => route !== undefined);
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
	const lines = [
		`\t${ADAPTERS[route.framework].name}<`,
		`\t\t${quote(route.path)},`,
		`\t\ttypeof import(${page}),`,
		`\t\t${serverType}`,
		`\t>({`,
		`\t\tname: ${quote(route.name)},`,
		// Svelte pages render from their compiled module in the manifest;
		// importing the `.svelte` source on the server is never needed.
		...(route.framework === 'react'
			? [`\t\tpage: () => import(${page}),`]
			: []),
		`\t\tpath: ${quote(route.path)},`,
		...(server ? [`\t\tserver: () => import(${server}),`] : []),
		`\t\tsource: ${source}`,
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

	return routeFromFile(root, relativePath, []);
};
export const fileRouteNamed = (name: string) =>
	[...registry().bySource.values()].find((route) => route.name === name);
export const fileRoutesOf = (framework: FileRouteFramework) =>
	[...registry().bySource.values()].filter(
		(route) => route.framework === framework
	);
export const isInFileRouteRoot = (path: string) =>
	rootFor(isAbsolute(path) ? path : resolve(path)) !== undefined;

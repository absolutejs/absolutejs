/* `absolute export [--to dir] [--outdir dir] [--flat] [--precompressed]
 *  [--json]`
 *
 * A directory to upload to S3, Netlify, Cloudflare Pages or GitHub Pages.
 *
 * Every mainstream framework has this — `next export`, `nuxt generate`,
 * `@sveltejs/adapter-static` — and it was the head of the plan's Reach
 * group, the largest block of section 5 nothing had touched.
 *
 * None of the rendering is new. `prerenderWithServer` already starts the
 * production server, crawls or takes a route list and writes HTML; what
 * was missing is everything around it, and the measurement that justifies
 * the command is in `staticExport.ts`: 79% of the example app's build
 * directory is server-only, and the ignore patterns that withhold it are a
 * property of the running server. Copy that directory to a static host and
 * `GET /server.js` works again.
 *
 * What this cannot do, said plainly rather than discovered later: a static
 * host runs no server, so API routes, form actions, ISR
 * (`static.revalidate`) and anything that reads a request are not
 * exportable. Routes come from `config.static.routes`, or from a crawl of
 * the links reachable from `/` — a page nothing links to is invisible to a
 * crawl, which is why the summary reports the route count and where it
 * came from. */

import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { getAvailablePort } from '../../testing/ports';
import {
	NOJEKYLL_FILE,
	planStaticExport,
	writeStaticExport,
	type StaticExportLayout,
	type StaticExportPage,
	type StaticExportPlan,
	type StaticExportSkipReason
} from '../../core/staticExport';
import {
	isServerOnlyBuildFile,
	productionStaticIgnorePatterns
} from '../../core/serverOnlyStaticFiles';
import { staticHostRuleFiles } from '../../core/routingRules';
import { formatBytes } from '../../utils/formatBytes';
import { loadConfig } from '../../utils/loadConfig';
import { getDurationString } from '../../utils/getDurationString';

const DEFAULT_EXPORT_DIR = 'out';
const DEFAULT_SERVER_ENTRY = 'server.ts';

const SKIP_LABELS: Record<StaticExportSkipReason, string> = {
	'page-override': 'replaced by a pre-rendered route',
	precompressed: 'pre-compressed copies (--precompressed keeps them)',
	'prerender-source': 'pre-render source, placed at its route instead',
	'server-only': 'server-only, never public'
};

const VALUE_FLAGS = ['--config', '--outdir', '--to'];

/** Refuse a destination that would take the project with it. An export
 *  clears its directory first, so the cost of getting this wrong is the
 *  source tree, and `--to .` is one keystroke from `--to ./out`. */
export const assertSafeDestination = (
	exportDir: string,
	buildDir: string,
	cwd = resolve(process.cwd())
) => {
	/* With the separator appended, so that `/project-out` is not read as a
	 * child of `/project`. A directory that already ends in one is the
	 * filesystem root, where appending another gives `//` and matches
	 * nothing — `--to /` was accepted by the first version of this. */
	const prefix = exportDir.endsWith('/') ? exportDir : `${exportDir}/`;
	if (exportDir === cwd || cwd.startsWith(prefix))
		throw new Error(
			`Refusing to export into ${exportDir}: it contains the project. Pass --to <dir>.`
		);
	if (exportDir === buildDir || buildDir.startsWith(prefix))
		throw new Error(
			`Refusing to export into ${exportDir}: it is the build directory. Pass --to <dir>.`
		);
};

/** The server entry, as `prepare` and `start` take it: the first argument
 *  that is neither a flag nor a flag's value. Without this an export of a
 *  project whose server is not `./server.ts` failed in the bundler with
 *  `ModuleNotFound resolving server.ts`, which says nothing about the
 *  argument that was missing. */
export const positionalEntry = (args: readonly string[]) => {
	const consumed = new Set<number>();
	for (const [index, arg] of args.entries())
		if (VALUE_FLAGS.includes(arg)) consumed.add(index + 1);

	return args.find(
		(arg, index) => !arg.startsWith('-') && !consumed.has(index)
	);
};

const namedArg = (args: readonly string[], flag: string) => {
	const index = args.indexOf(flag);
	const value = index === -1 ? undefined : args[index + 1];

	return value === undefined || value.startsWith('-') ? undefined : value;
};

/** Every file under `dir`, each as a leading-slash path relative to it —
 *  the shape the ignore patterns match. Dot-directories are included:
 *  `.absolutejs/generated/` holds the React hydration indexes a page loads
 *  by URL. */
const buildFilePaths = async (dir: string, base = dir): Promise<string[]> => {
	const entries = await readdir(dir, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) return buildFilePaths(full, base);

			return [`/${relative(base, full).split('\\').join('/')}`];
		})
	);

	return nested.flat();
};

const emptyDirectory = async (dir: string) => {
	await rm(dir, { force: true, recursive: true });
	await mkdir(dir, { recursive: true });
};

const countsByReason = (plan: StaticExportPlan) => {
	const counts = new Map<StaticExportSkipReason, number>();
	for (const skip of plan.skipped)
		counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);

	return counts;
};

/* The config's redirects, rewrites and headers, as the two files Netlify
 * and Cloudflare Pages read from a published directory. There is no
 * server in an export to apply them, so without these a rule that works
 * under `absolute start` would silently not exist on the static site. */
const REDIRECTS_FILE = '_redirects';
const HEADERS_FILE = '_headers';

const writeRuleFiles = async (exportDir: string, configPath?: string) => {
	const config = await loadConfig(configPath);
	const files = staticHostRuleFiles(config);
	const written: string[] = [];
	if (files.redirects !== null) {
		await Bun.write(join(exportDir, REDIRECTS_FILE), files.redirects);
		written.push(REDIRECTS_FILE);
	}
	if (files.headers !== null) {
		await Bun.write(join(exportDir, HEADERS_FILE), files.headers);
		written.push(HEADERS_FILE);
	}

	return written;
};

const reportPlan = (
	plan: StaticExportPlan,
	exportDir: string,
	bytes: number,
	files: number,
	duration: string
) => {
	console.log(
		`\nExported ${plan.pages.length} ${plan.pages.length === 1 ? 'page' : 'pages'} and ${plan.copies.length} assets to ${relative(process.cwd(), exportDir) || '.'} \x1b[2m(${formatBytes(bytes)}, ${files} files, ${duration})\x1b[0m`
	);
	for (const [reason, count] of countsByReason(plan))
		console.log(`  \x1b[2mskipped ${count} ${SKIP_LABELS[reason]}\x1b[0m`);
	console.log(
		`  \x1b[2mwrote ${NOJEKYLL_FILE} so hosts running Jekyll serve /.absolutejs/ and /_* paths\x1b[0m`
	);
};

const warnAboutDynamicParts = (
	hasStaticConfig: boolean,
	revalidate?: number
) => {
	if (!hasStaticConfig)
		console.warn(
			'\x1b[33mRoutes were discovered by crawling links from /. A page nothing links to was not exported — list routes in `static.routes` to be sure.\x1b[0m'
		);
	if (revalidate !== undefined)
		console.warn(
			`\x1b[33m\`static.revalidate\` (${revalidate}s) does nothing in an export: re-rendering stale pages needs a running server.\x1b[0m`
		);
	console.warn(
		'\x1b[33mA static host runs no server, so API routes, form actions and anything reading a request are not part of this export.\x1b[0m'
	);
};

/** Build, pre-render, and assemble a directory a static host can serve. */
export const runExport = async (args: readonly string[]) => {
	const started = performance.now();
	const configPath = namedArg(args, '--config');
	const outdir = namedArg(args, '--outdir');
	const layout: StaticExportLayout = args.includes('--flat')
		? 'flat'
		: 'directory';

	const { start } = await import('./start');
	const serverEntry = positionalEntry(args) ?? DEFAULT_SERVER_ENTRY;
	const prepared = await start(serverEntry, outdir, configPath, {
		prepareOnly: true,
		skipPrerender: true
	});
	if (prepared === undefined)
		throw new Error('The build did not report its output paths.');

	const buildDir = prepared.resolvedOutdir;
	const exportDir = resolve(namedArg(args, '--to') ?? DEFAULT_EXPORT_DIR);
	assertSafeDestination(exportDir, buildDir);

	const { formatPrerenderFailure, prerenderWithServer } =
		await import('../../core/prerender');
	const staticConfig = prepared.staticConfig ?? { routes: 'all' as const };
	/* A free port from the OS rather than `PORT + 1`. The fixed offset
	 * collided with an unrelated dev server on this machine, and because
	 * the readiness probe accepts any listener the pre-render ran against
	 * the stranger and exported a site with no pages. */
	const result = await prerenderWithServer(
		prepared.outputPath,
		await getAvailablePort(),
		buildDir,
		staticConfig,
		{
			ABSOLUTE_BUILD_DIR: buildDir,
			ABSOLUTE_INSTANCE_MANAGED: '1',
			ABSOLUTE_VERSION: prepared.absoluteVersion,
			FORCE_COLOR: '0',
			NODE_ENV: 'production',
			...(configPath ? { ABSOLUTE_CONFIG: configPath } : {})
		},
		(message) => console.log(message)
	);

	const prerendered: StaticExportPage[] = [...result.routes].map(
		([route, file]) => ({ file, route })
	);
	const plan = planStaticExport({
		buildFiles: await buildFilePaths(buildDir),
		isServerOnly: isServerOnlyBuildFile(
			productionStaticIgnorePatterns(buildDir, prepared.outputPath)
		),
		layout,
		precompressed: args.includes('--precompressed'),
		prerendered
	});

	await emptyDirectory(exportDir);
	const written = await writeStaticExport(plan, buildDir, exportDir);
	const ruleFiles = await writeRuleFiles(exportDir, configPath);

	if (args.includes('--json')) {
		process.stdout.write(
			`${JSON.stringify(
				{
					bytes: written.bytes,
					dir: exportDir,
					failures: result.failures,
					files: written.files,
					layout,
					pages: plan.pages.map((page) => ({
						path: page.to,
						route: page.route
					})),
					ruleFiles,
					skipped: plan.skipped
				},
				null,
				2
			)}\n`
		);
	} else {
		reportPlan(
			plan,
			exportDir,
			written.bytes,
			written.files,
			getDurationString(performance.now() - started)
		);
		if (ruleFiles.length > 0)
			console.log(
				`  \x1b[2mwrote ${ruleFiles.join(' and ')} from the config's redirects, rewrites and headers; Netlify and Cloudflare Pages apply them, other static hosts ignore them\x1b[0m`
			);
		warnAboutDynamicParts(
			prepared.staticConfig !== undefined,
			prepared.staticConfig?.revalidate
		);
	}

	if (result.failures.length === 0) return;

	/* A route that failed to render is a page the export does not contain,
	 * which is a broken site rather than a warning — `absolute start` can
	 * fall back to rendering it, and a static host cannot. */
	for (const failure of result.failures)
		console.error(`\x1b[31m${formatPrerenderFailure(failure)}\x1b[0m`);
	process.exitCode = 1;
};
